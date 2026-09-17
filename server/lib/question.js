// question.js —— 问题页数据服务（API 取回答，热度/时间两种排序）
//
// 2026-09-14 实况（真实会话实测）：
//   - 知乎内容页 SSR（www.zhihu.com/question/xxx 等）现在统一返回 403 的
//     zse-ck 反爬挑战页（需要 JS 算 cookie），Node 侧抓不到；首页 / 热榜页仍 200。
//     所以问题页不再走 SSR，全部改走 API。
//   - /api/v4/questions/{qid}/answers?limit=N&include=<长 include> 可用，返回带
//     完整正文的回答（默认=热度排序），paging.next 是 offset 分页，稳定；
//     但它不认 order 参数（updated/created 都回落默认），所以“时间排序”仍用
//     feeds?order=updated（实测严格按 updated_time 倒序）。
//   - 两种分页口径不同：answers 用 offset，feeds 用 cursor（next 自身带 order，
//     但仍手动补一次，防知乎改口径）。

import { request } from './zhihu.js'

// 长 include：正文 content + 问题 + 作者 + 计数，照抄知乎自己 SSR next 里那一串
const INCLUDE =
  'data[*].is_normal,admin_closed_comment,reward_info,is_collapsed,annotation_action,annotation_detail,collapse_reason,is_sticky,collapsed_by,suggest_edit,comment_count,can_comment,content,editable_content,attachment,voteup_count,reshipment_settings,comment_permission,created_time,updated_time,review_info,relevant_info,question,excerpt'

function cleanNext(url) {
  return (url ?? '').replace('zhihu.com//api', 'zhihu.com/api')
}

/** 取 camel/snake 两种形态的字段 */
const pick = (obj, camel, snake) => obj?.[camel] ?? obj?.[snake] ?? null

/** 规范化为统一的回答结构（v1 界面消费形态） */
export function normalizeAnswer(a, questionFallback = null) {
  if (!a) return null
  const id = String(pick(a, 'id', 'id') ?? '')
  const q = a.question ?? questionFallback
  return {
    id,
    type: pick(a, 'answerType', 'answer_type') ?? 'answer',
    content: pick(a, 'content', 'content') ?? '',
    excerpt: pick(a, 'excerpt', 'excerpt') ?? '',
    voteupCount: pick(a, 'voteupCount', 'voteup_count') ?? 0,
    commentCount: pick(a, 'commentCount', 'comment_count') ?? 0,
    thanksCount: pick(a, 'thanksCount', 'thanks_count') ?? 0,
    createdTime: pick(a, 'createdTime', 'created_time') ?? null,
    updatedTime: pick(a, 'updatedTime', 'updated_time') ?? null,
    url: pick(a, 'url', 'url') ?? null,
    author: a.author
      ? {
          id: pick(a.author, 'id', 'id') ?? null,
          name: pick(a.author, 'name', 'name') ?? '',
          urlToken: pick(a.author, 'urlToken', 'url_token') ?? '',
          headline: pick(a.author, 'headline', 'headline') ?? '',
          avatarUrl: pick(a.author, 'avatarUrl', 'avatar_url') ?? '',
        }
      : null,
    question: q
      ? {
          id: String(pick(q, 'id', 'id') ?? ''),
          title: pick(q, 'title', 'title') ?? '',
          url: pick(q, 'url', 'url') ?? null,
        }
      : null,
  }
}

export function normalizeQuestion(q) {
  if (!q) return null
  return {
    id: String(pick(q, 'id', 'id') ?? ''),
    title: pick(q, 'title', 'title') ?? '',
    detail: pick(q, 'detail', 'detail') ?? '',
    excerpt: pick(q, 'excerpt', 'excerpt') ?? '',
    answerCount: pick(q, 'answerCount', 'answer_count') ?? null,
    commentCount: pick(q, 'commentCount', 'comment_count') ?? null,
    followerCount: pick(q, 'followerCount', 'follower_count') ?? null,
    url: pick(q, 'url', 'url') ?? null,
    topics: Array.isArray(q?.topics) ? q.topics.map((t) => t?.name ?? '') : [],
  }
}

function answersUrl(qid, limit) {
  return `/api/v4/questions/${qid}/answers?limit=${limit}&include=${encodeURIComponent(INCLUDE)}`
}

function updatedUrl(qid, limit) {
  return `/api/v4/questions/${qid}/feeds?limit=${limit}&order=updated&include=${encodeURIComponent(INCLUDE)}`
}

/**
 * 问题页第一页。
 * default = 热度：answers 端点（offset 分页，自带正文）。
 * updated = 时间：feeds 端点（cursor 分页，order=updated 严格倒序）。
 */
export async function questionFirstPage(qid, { order = 'default', limit = 5 } = {}) {
  if (!/^\d+$/.test(String(qid))) throw Object.assign(new Error('问题 id 不合法'), { status: 400 })
  const isUpdated = order === 'updated'
  const json = await request(isUpdated ? updatedUrl(qid, limit) : answersUrl(qid, limit))
  const rows = (json.data ?? []).map((d) => d.target ?? d)
  const answers = rows.map((d) => normalizeAnswer(d)).filter(Boolean)
  // 问题标题等头信息：answers/feeds 的每条都带 question 字段，取第一条的即可
  const qEntity = rows[0]?.question ?? null
  return {
    question: normalizeQuestion(qEntity) ?? { id: String(qid), title: '' },
    answers,
    nextUrl: cleanNext(json.paging?.next ?? ''),
    order: isUpdated ? 'updated' : 'default',
    isEnd: json.paging?.is_end === true || !json.paging?.next,
  }
}

/** 续页：给定上一页的 nextUrl（绝对地址）与期望排序 */
export async function questionNextPage(nextUrl, { order = 'default' } = {}) {
  const u = new URL(cleanNext(nextUrl))
  if (u.hostname !== 'www.zhihu.com') throw Object.assign(new Error('续页 URL 不合法'), { status: 400 })
  // feeds 的 next 自带 order，但知乎改口径时会丢，补一次；answers 端点不认这个参数，无副作用
  if (order === 'updated') u.searchParams.set('order', 'updated')
  const json = await request(u.pathname + u.search)
  const answers = (json.data ?? []).map((d) => normalizeAnswer(d.target ?? d)).filter(Boolean)
  return {
    answers,
    nextUrl: cleanNext(json.paging?.next ?? ''),
    order,
    isEnd: json.paging?.is_end === true || !json.paging?.next,
  }
}
