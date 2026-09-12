// ui.js —— 通用卡片零件：作者行、回答卡片、操作条
import { esc, fmtTime, fillContent } from './render.js'
import { api } from './api.js'
import { playVideoIn } from './video.js'

export function authorBlock(author) {
  const box = document.createElement('div')
  box.className = 'answer-author'
  const avatar = author?.avatarUrl || author?.avatar_url
  box.innerHTML =
    (avatar ? `<img class="avatar" alt="" loading="lazy" src="${esc(api.mediaUrl(avatar))}" referrerpolicy="no-referrer">` : '<span class="avatar"></span>') +
    `<div><div class="author-name">${esc(author?.name ?? '匿名用户')}</div>` +
    (author?.headline ? `<div class="author-headline">${esc(author.headline)}</div>` : '') +
    '</div>'
  return box
}

/** 推荐流反馈按钮组（不喜欢该内容 / 不看该作者），供卡片头部使用 */
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
  return fb
}

/**
 * 渲染一条“回答式”卡片（回答 / 文章 / 想法共用）。
 * @param {{kind:string, title?:string, content:string, excerpt?:string, author?:object,
 *          voteupCount?:number, commentCount?:number, createdTime?:number|string,
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

  if (a.author) card.appendChild(authorBlock(a.author))

  const body = document.createElement('div')
  body.className = 'content-body'
  fillContent(body, a.content ?? a.excerpt ?? '', {
    onVideo: (videoId, holder) => playVideoIn(videoId, a.answerId || a.id, holder, {
      onError: (msg) => { holder.innerHTML = `<p class="muted">${msg}</p>` },
    }),
  })
  card.appendChild(body)

  const meta = document.createElement('div')
  meta.className = 'answer-meta'
  meta.innerHTML =
    `<span>👍 ${a.voteupCount ?? 0}</span>` +
    (a.createdTime != null ? `<span>${fmtTime(a.createdTime)}</span>` : '') +
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

/** 底部翻页导航条 */
export function navBar({ onPrev, onNext, prevText = '◀ 上一条', nextText = '下一条 ▶' }) {
  const bar = document.createElement('div')
  bar.className = 'navbar'
  const prev = document.createElement('button')
  prev.className = 'btn'
  prev.textContent = prevText
  prev.addEventListener('click', onPrev)
  const next = document.createElement('button')
  next.className = 'btn btn-primary'
  next.textContent = nextText
  next.addEventListener('click', onNext)
  bar.appendChild(prev)
  bar.appendChild(next)
  return { bar, prev, next }
}
