// content.js —— 详情页视图（文章/想法/视频）
// 数据来自推荐流会话缓存（完整正文在 feed 里已带）；缓存里没有时给出外链兜底。
import { esc, fillContent } from '../render.js'
import { answerCard, navBar, authorBlock } from '../ui.js'
import { openComments } from '../comments.js'
import { store as recStore } from './recommend.js'
import * as report from '../readreport.js'

export function findCachedEntity(kind, id) {
  return recStore.items.find((it) => {
    const url = it.url ?? ''
    if (kind === 'article') return (String(url.match(/\/p\/(\d+)/)?.[1] ?? '') === String(id)) || it.id === String(id)
    if (kind === 'pin') return String(url.match(/\/pin\/(\d+)/)?.[1] ?? '') === String(id)
    return it.id === String(id)
  }) ?? null
}

export function mount(container, { kind, id }) {
  const el = document.createElement('div')
  container.appendChild(el)

  const back = document.createElement('button')
  back.type = 'button'
  back.className = 'back-link'
  back.textContent = '返回'
  back.setAttribute('aria-label', '返回上一页')
  back.addEventListener('click', () => {
    history.back()
  })
  el.appendChild(back)

  const it = findCachedEntity(kind, id)
  if (!it) {
    el.insertAdjacentHTML(
      'beforeend',
      '<div class="card"><p class="muted">本条内容不在会话缓存里（从外部链接进来的）。</p></div>'
    )
    return { refresh: () => {}, step() {} }
  }
  const head = document.createElement('div')
  head.className = 'question-head'
  const h = document.createElement('h1')
  h.style.fontSize = '20px'
  h.textContent = it.title || (kind === 'article' ? '文章' : '想法')
  head.appendChild(h)
  el.appendChild(head)

  // 打开详情 = 读过这条（照网页版：打开内容时上报）
  report.noteRead({ machineType: kind, id: String(id) })

  if (kind === 'article') {
    const card = answerCard(it, {
      onComment: (a, btn, cardEl) => {
        const aid = a.answerId || a.id
        if (aid) openComments('article', aid, cardEl, btn)
      },
    })
    el.appendChild(card)
    const nb = navBar({ onPrev: () => history.back(), onNext: () => window.scrollTo({ top: 0 }) })
    nb.prev.textContent = '‹ 返回列表'
    nb.next.textContent = '回到顶部 ↑'
    el.appendChild(nb.bar)
  } else {
    const card = document.createElement('article')
    card.className = 'card'
    if (it.author) card.appendChild(authorBlock(it.author))
    const body = document.createElement('div')
    body.className = 'content-body'
    fillContent(body, it.content || it.excerpt)
    card.appendChild(body)
    el.appendChild(card)
  }
  return { refresh: () => {}, step() {} }
}
