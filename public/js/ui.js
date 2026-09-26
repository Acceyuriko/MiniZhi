// ui.js —— 通用卡片零件：作者行、回答卡片、操作条
import { esc, fmtTime, fillContent } from './render.js'
import { api } from './api.js'
import { playVideoIn } from './video.js'

export function authorBlock(author, ip = null) {
  const box = document.createElement('div')
  box.className = 'answer-author'
  const avatar = author?.avatarUrl || author?.avatar_url
  box.innerHTML =
    (avatar ? `<img class="avatar" alt="" loading="lazy" src="${esc(api.mediaUrl(avatar))}" referrerpolicy="no-referrer">` : '<span class="avatar"></span>') +
    '<div class="author-box">' +
    `<div class="author-line"><span class="author-name">${esc(author?.name ?? '匿名用户')}</span>` +
    (ip ? `<span class="author-ip">${esc(ip)}</span>` : '') +
    '</div>' +
    (author?.headline ? `<div class="author-headline">${esc(author.headline)}</div>` : '') +
    '</div>'
  return box
}

/** 这条内容在知乎的网页地址（分享用）。
 *  按类型 + id 拼，不用 url 字段（feed 里给的是 https://api.zhihu.com/answers/xxx，
 *  分享出去打不开）；问题页的回答没有 machineType 字段，按回答处理。 */
export function zhihuUrlOf(a) {
  const kind = a.machineType ?? a.rawType ?? 'answer'
  const aid = a.answerId || a.id
  const qid = a.questionId || a.question?.id
  if (kind === 'answer' && aid) {
    return qid
      ? `https://www.zhihu.com/question/${qid}/answer/${aid}`
      : `https://www.zhihu.com/answer/${aid}`
  }
  if (kind === 'article' && a.id) return `https://zhuanlan.zhihu.com/p/${a.id}`
  if (kind === 'pin' && a.id) return `https://www.zhihu.com/pin/${a.id}`
  return a.url ?? ''
}

const toast = (msg) => document.dispatchEvent(new CustomEvent('minizhi:toast', { detail: msg }))

/** 分享：把这条内容的知乎链接复制到剪贴板 */
async function copyZhihuLink(a) {
  const url = zhihuUrlOf(a)
  if (!url) return toast('这条内容没有可复制的知乎链接')
  try {
    await navigator.clipboard.writeText(url)
    toast('已复制知乎链接')
  } catch {
    toast('复制失败：' + url)
  }
}

/** 卡片头部按钮组（不喜欢该内容 / 不看该作者 / 分享） */
export function feedbackRow(onDiscard, a) {
  const fb = document.createElement('div')
  fb.className = 'card-feedback'
  for (const [act, label] of [
    ['content', '不喜欢该内容'],
    ['author', '不看该作者'],
  ]) {
    const b = document.createElement('button')
    b.className = 'ghost'
    b.textContent = label
    b.addEventListener('click', () => onDiscard(act, a, b))
    fb.appendChild(b)
  }
  const share = document.createElement('button')
  share.className = 'ghost share'
  share.textContent = '分享'
  share.addEventListener('click', () => copyZhihuLink(a))
  fb.appendChild(share)
  return fb
}

/**
 * 渲染一条“回答式”卡片（回答 / 文章 / 想法共用）。
 * @param {{kind:string, title?:string, content:string, excerpt?:string, author?:object,
 *          voteupCount?:number, commentCount?:number, createdTime?:number|string,
 *          updatedTime?:number|string,
 *          question?:object, id:string, url?:string, answerId?:string}} a 已归一化的实体
 * @param {{onComment?:fn(id), onQuestion?:fn(qid, aid), onDiscard?:fn(act, a, btn)}} h 行为回调
 */
export function answerCard(a, h = {}) {
  const card = document.createElement('article')
  card.className = 'card'

  // 顶行：类型标签 +（推荐流）反馈按钮 —— 一眼营销文不用滚到底就能毙掉
  const top = document.createElement('div')
  top.className = 'card-top'
  const kindTag = document.createElement('span')
  kindTag.className = 'item-kind'
  kindTag.textContent = a.kind ?? '回答'
  top.appendChild(kindTag)
  if (h.onDiscard) top.appendChild(feedbackRow(h.onDiscard, a))
  card.appendChild(top)

  const head = document.createElement('div')
  if (a.question?.title) {
    const q = document.createElement('div')
    q.className = 'answer-question'
    const link = document.createElement('a')
    link.textContent = a.question.title
    link.style.fontWeight = '600'
    // 真链接：可键盘聚焦 / 中键新开 / 复制地址（hash 路由由 app 接管）
    if (a.question.id) {
      link.href = `#question/${a.question.id}` + (a.answerId || a.id ? `?from=${a.answerId || a.id}` : '')
    } else if (a.url) {
      link.href = a.url
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
    } else {
      link.href = '#recommend'
    }
    q.appendChild(link)
    if (a.question.answerCount) {
      const m = document.createElement('span')
      m.className = 'muted'
      m.textContent = ` · ${a.question.answerCount} 个回答`
      q.appendChild(m)
    }
    head.appendChild(q)
  } else if (a.title) {
    const t = document.createElement('div')
    t.className = 'answer-question'
    t.style.fontWeight = '600'
    t.textContent = a.title
    head.appendChild(t)
  }
  card.appendChild(head)

  if (a.author) card.appendChild(authorBlock(a.author, a.ipInfo))

  const body = document.createElement('div')
  body.className = 'content-body'
  fillContent(body, a.content ?? a.excerpt ?? '', {
    onVideo: (videoId, holder) => playVideoIn(videoId, a.answerId || a.id, holder),
  })
  card.appendChild(body)

  const meta = document.createElement('div')
  meta.className = 'answer-meta'
  const kindLabel = a.kind && a.kind !== '回答' ? '发布于' : '回答于'
  meta.innerHTML =
    `<span>👍 ${a.voteupCount ?? 0}</span>` +
    (a.createdTime != null ? `<span>${kindLabel} ${fmtTime(a.createdTime)}</span>` : '') +
    (a.updatedTime != null && a.updatedTime !== a.createdTime
      ? `<span>编辑于 ${fmtTime(a.updatedTime)}</span>`
      : '') +
    (a.commentCount != null ? `<span>${a.commentCount} 条评论</span>` : '')
  const btn = document.createElement('button')
  btn.className = 'ghost'
  btn.textContent = '💬 评论'
  btn.setAttribute('aria-expanded', 'false')
  btn.addEventListener('click', () => h.onComment?.(a, btn, card))
  meta.appendChild(btn)
  if (a.url && !a.question) {
    const ext = document.createElement('a')
    ext.href = a.url
    ext.target = '_blank'
    ext.rel = 'noopener noreferrer'
    ext.textContent = '在知乎打开 ↗'
    ext.className = 'qlink'
    meta.appendChild(ext)
  }
  card.appendChild(meta)
  return card
}

/** 底部翻页导航条（onFirst 只在需要「最前」按钮时传） */
export function navBar({ onFirst, onPrev, onNext, prevText = '◀ 上一条', nextText = '下一条 ▶' }) {
  const bar = document.createElement('div')
  bar.className = 'navbar'
  let first = null
  if (onFirst) {
    first = document.createElement('button')
    first.className = 'btn nav-first'
    first.textContent = '⏮ 最前'
    first.addEventListener('click', onFirst)
    bar.appendChild(first)
  }
  const prev = document.createElement('button')
  prev.className = 'btn nav-prev'
  prev.textContent = prevText
  prev.addEventListener('click', onPrev)
  const next = document.createElement('button')
  next.className = 'btn btn-primary nav-next'
  next.textContent = nextText
  next.addEventListener('click', onNext)
  bar.appendChild(prev)
  bar.appendChild(next)
  return { bar, prev, next, first }
}
