// question.js —— 问题页数据服务（SSR 首页 + cursor 续页 + 时间排序）
//
// 2026 新版知乎的实况（全部经真实请求验证，细节见 agents.md 实测经验）：
//   - 问题页正文在 SSR HTML（<script id="js-initialData">）里：entities.answers
//     是全量回答实体（camelCase），question.answers.{qid}.ids 是有序引用，
//     .next 是下一页的完整 API URL（cursor + data[*].xxx 长 include）。
//   - 旧式 include（offset 分页）已废弃：任何 include → HTML 404。
//   - “时间排序”用 feeds?order=updated + 长 include 直取第一页（带正文）；
//     续页取 paging.next 后手动补 order=updated（next 自己不带 order）。
//   - feeds 的 paging.next 偶发 zhihu.com//api 双斜杠，使用前必须清洗。

import { plainGetText, request } from './zhihu.js'
import { parseZhihuJson } from './zhihu.js'

// 现代 feeds include（照抄 SSR next 里知乎自己生成的那一串）
const FEEDS_INCLUDE =
  'data[*].is_normal,admin_closed_comment,reward_info,is_collapsed,annotation_action,annotation_detail,collapse_reason,is_sticky,collapsed_by,suggest_edit,comment_count,can_comment,content,editable_content,attachment,voteup_count,reshipment_settings,comment_permission,created_time,updated_time,review_info,relevant_info,question,excerpt'

function cleanNext(url) {
  return (url ?? '').replace('zhihu.com//api', 'zhihu.com/api')
}

function unescapeInitialData(text) {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#x2F;/g, '/')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

/** 抽取并解析 js-initialData */
export function parseInitialData(html) {
  const m = html.match(/<script id="js-initialData" type="text\/json">([\s\S]*?)<\/script>/)
  if (!m) return null
  return parseZhihuJson(unescapeInitialData(m[1]))
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

/** 热度（默认）排序第一页：SSR 首页 */
async function firstPageDefault(qid) {
  const html = await plainGetText(`https://www.zhihu.com/question/${qid}`, {
    referer: 'https://www.zhihu.com/',
  })
  const data = parseInitialData(html)
  if (!data) throw Object.assign(new Error('问题页 SSR 里没有 initialData（可能问题不存在或被反爬拦截）'), { status: 404 })
  const list = data.initialState?.question?.answers?.[qid]
  const entities = data.initialState?.entities
  const qEntity = entities?.questions?.[qid]
  const answers = []
  for (const item of list?.ids ?? []) {
    const aid = item?.target
    const ans = entities?.answers?.[aid]
    if (!ans) continue
    const row = normalizeAnswer(ans)
    if (row) {
      row.cursor = item.cursor ?? null
      answers.push(row)
    }
  }
  return {
    question: normalizeQuestion(qEntity),
    answers,
    nextUrl: cleanNext(list?.next ?? ''),
    order: 'default',
  }
}

function updatedFirstUrl(qid, limit) {
  return `/api/v4/questions/${qid}/feeds?limit=${limit}&order=updated&include=${encodeURIComponent(FEEDS_INCLUDE)}`
}

/** 时间排序第一页：API（带正文）；问题头信息用轻量 API 详情 */
async function firstPageUpdated(qid, limit) {
  const [qJson, feedJson] = await Promise.allSettled([
    request(`/api/v4/questions/${qid}`),
    request(updatedFirstUrl(qid, limit)),
  ])
  // 注意：两个请求会先后进入同一个串行队列，Promise.allSettled 不违反风控预算
  const feed = feedJson.status === 'fulfilled' ? feedJson.value : null
  if (!feed) throw feedJson.reason
  const qApi = qJson.status === 'fulfilled' ? qJson.value : null
  const answers = (feed.data ?? []).map((d) => normalizeAnswer(d.target ?? d)).filter(Boolean)
  return {
    question: qApi ? normalizeQuestion(qApi) : { id: String(qid), title: '' },
    answers,
    nextUrl: cleanNext(feed.paging?.next ?? ''),
    order: 'updated',
  }
}

/** 问题页第一页 */
export async function questionFirstPage(qid, { order = 'default', limit = 5 } = {}) {
  if (!/^\d+$/.test(String(qid))) throw Object.assign(new Error('问题 id 不合法'), { status: 400 })
  return order === 'updated' ? firstPageUpdated(qid, limit) : firstPageDefault(String(qid))
}

/**
 * 续页：给定上一页的 nextUrl（绝对地址）与期望排序，返回下一页。
 * order=updated 时手动补 order 参数（next 自身不带，丢了就会回落默认排序）。
 */
export async function questionNextPage(nextUrl, { order = 'default' } = {}) {
  const cleaned = cleanNext(nextUrl)
  const u = new URL(cleaned)
  if (order === 'updated') u.searchParams.set('order', 'updated')
  if (u.hostname !== 'www.zhihu.com') throw Object.assign(new Error('续页 URL 不合法'), { status: 400 })
  const pathAndQuery = u.pathname + u.search
  const json = await request(pathAndQuery)
  const answers = (json.data ?? []).map((d) => normalizeAnswer(d.target ?? d)).filter(Boolean)
  return {
    answers,
    nextUrl: cleanNext(json.paging?.next ?? ''),
    order,
    isEnd: json.paging?.is_end === true || !json.paging?.next,
  }
}
