// recommend.js —— 推荐流视图：单条大卡片、会话级记忆、尾部自动续页
import { api, SessionError } from '../api.js'
import { answerCard, navBar, authorBlock, feedbackRow } from '../ui.js'
import { esc, fmtTime, fillContent } from '../render.js'
import { playVideoIn } from '../video.js'
import { openComments } from '../comments.js'
import * as discard from '../discard.js'

// 会话级状态：切 Tab / 切路由回来不丢
export const store = {
  items: [], // 归一化条目
  index: 0,
  nextUrl: null,
  loading: false,
  loadedAt: 0,
  errored: null,
}

const KIND = { answer: '回答', article: '文章', pin: '想法', video: '视频' }

/** 知乎推荐流条目 → 归一化（过滤广告、跳过无正文壳子） */
function normalizeFeedItem(item) {
  const t = item?.target ?? {}
  if (!t || t.type === 'ad' || item.type === 'ad' || t.type === 'ad_recommend') return null
  const kind = KIND[t.type] ?? (t.type ? String(t.type) : null)
  if (!kind) return null
  const question = t.question
    ? {
        id: String((String(t.question.url ?? '').match(/\/question\/(\d+)/) ?? [])[1] ?? t.question.id ?? ''),
        title: t.question.title ?? '',
        answerCount: t.question.answer_count ?? t.question.answerCount,
      }
    : null
  const aid = String((String(t.url ?? '').match(/\/answer\/(\d+)/) ?? [])[1] ?? '')
  const qid = String((String(t.url ?? '').match(/\/question\/(\d+)/) ?? [])[1] ?? '')
  const author = t.author
    ? {
        id: t.author.id ?? t.author.url_token ?? null,
        name: t.author.name,
        urlToken: t.author.url_token ?? t.author.urlToken,
        headline: t.author.headline,
        avatarUrl: t.author.avatar_url ?? t.author.avatarUrl,
      }
    : null
  const row = {
    rawType: t.type,
    machineType: t.type ?? 'answer',
    kind,
    id: aid || qid || String(t.id ?? ''),
    title: t.title ?? '',
    content: t.content ?? t.content_text ?? '',
    excerpt: t.excerpt ?? '',
    voteupCount: t.voteup_count ?? t.voteupCount ?? 0,
    commentCount: t.comment_count ?? t.commentCount ?? 0,
    createdTime: t.created_time ?? t.createdTime ?? t.updated_time ?? t.updatedTime ?? null,
    author,
    question,
    url: t.url ?? item.url ?? '',
    answerId: aid || null,
    questionId: qid || null,
  }
  // 视频条目（feed 的 zvideo 壳没有正文，读不了；给出外链/独立播放）
  if (t.type === 'video' || t.type === 'zvideo') row.externalOnly = true
  return row
}

export async function loadFirst({ fresh = false } = {}) {
  if (!fresh && store.items.length > 0) return
  store.loading = true
  store.errored = null
  try {
    const json = await api.recommend(20)
    const items = discard.filterList((json.data ?? []).map(normalizeFeedItem).filter(Boolean))
    if (fresh) {
      store.items = items
      store.index = 0
    } else {
      store.items.push(...items)
    }
    store.nextUrl = json.paging?.next ?? null
    store.loadedAt = Date.now()
    if (store.items.length === 0) store.errored = '推荐流暂时为空'
  } catch (err) {
    store.errored = err.message ?? String(err)
    if (err instanceof SessionError) throw err
  } finally {
    store.loading = false
  }
}

/** 尾部续页（自动追加一页，不移动当前条目）。
 *  被屏蔽的条目不入列：最多连追 3 页直到拿到可见内容或到底。 */
async function appendMore() {
  if (!store.nextUrl || store.loading) return false
  store.loading = true
  try {
    let added = 0
    for (let i = 0; i < 3; i++) {
      if (!store.nextUrl) break
      const json = await api.zh(store.nextUrl)
      const items = discard.filterList((json.data ?? []).map(normalizeFeedItem).filter(Boolean))
      store.items.push(...items)
      added += items.length
      store.nextUrl = json.paging?.next ?? null
      if (items.length > 0 || !store.nextUrl) break
    }
    return added > 0
  } catch (err) {
    throw err
  } finally {
    store.loading = false
  }
}

function idOfUrl(url) {
  const q = String(url ?? '').match(/\/question\/(\d+)/)?.[1]
  const a = String(url ?? '').match(/\/answer\/(\d+)/)?.[1]
  return { qid: q ?? null, aid: a ?? null }
}

/** 平滑滚动到本视图的回答卡片（避开顶栏），用于翻页后定位 */
function scrollToCard(el) {
  requestAnimationFrame(() => {
    const card = el.querySelector('.card')
    card?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  })
}

/** 不喜欢该内容 / 不看该作者：云端反馈（尽力）+ 本地黑名单 + 立即移除当前条目 */
async function handleDiscard(el, onNav, act, btn) {
  const it = store.items[store.index]
  if (!it) return
  if (btn) btn.disabled = true
  const authorMode = act === 'author'
  if (authorMode && !it.author) {
    document.dispatchEvent(new CustomEvent('minizhi:toast', { detail: '这条内容没有作者信息' }))
    return
  }
  // 1) 云端反馈（不阻塞本地；失败静默降级为本地屏蔽）
  let cloudMsg = ''
  const res = await discard.reportUninterested(it, authorMode ? 'author' : 'less_similar')
  if (res.err) {
    if (res.err instanceof SessionError) {
      document.dispatchEvent(new CustomEvent('minizhi:error', { detail: { err: res.err } }))
    } else {
      cloudMsg = '（云端反馈失败，仅本地屏蔽）'
    }
  } else if (!res.sent) {
    cloudMsg = '（该类型暂不支持云端反馈，仅本地屏蔽）'
  }
  // 2) 本地黑名单 + 移除
  if (authorMode) {
    discard.blockAuthor(it)
    store.items = store.items.filter((x) => !discard.isAuthorBlocked(x))
  } else {
    discard.blockContent(it)
    store.items.splice(store.index, 1)
  }
  // 3) 修复位置并重渲染
  if (store.index >= store.items.length) {
    store.index = Math.max(0, store.items.length - 1)
  }
  renderItemView(el, onNav, true)
  scrollToCard(el)
  document.dispatchEvent(
    new CustomEvent('minizhi:toast', {
      detail: (authorMode ? '已屏蔽该作者' : '已忽略该内容') + cloudMsg,
    })
  )
}

function renderItemView(el, onNav, anchor = false) {
  el.innerHTML = ''
  const it = store.items[store.index]
  if (!it) {
    // 可能当前页全被屏蔽/删空：还有下一页就自动追
    if (store.nextUrl && !store.loading) {
      el.innerHTML = '<div class="loading spin">加载更多…</div>'
      appendMore()
        .then(() => {
          if (store.items.length > 0) renderItemView(el, onNav)
          else el.innerHTML = '<div class="empty">没有内容，点右上角"刷新"试试</div>'
        })
        .catch((err) =>
          document.dispatchEvent(new CustomEvent('minizhi:error', { detail: { err } }))
        )
    } else {
      el.innerHTML = '<div class="empty">没有内容，点右上角“刷新”试试</div>'
    }
    return
  }
  const meta = document.createElement('div')
  meta.className = 'reader-meta'
  const span = document.createElement('span')
  span.textContent = `${it.kind} ${store.index + 1} / ${store.items.length}`
  meta.appendChild(span)
  if (store.nextUrl && store.index >= store.items.length - 3) {
    const more = document.createElement('span')
    more.textContent = store.loading ? '加载下一页…' : ''
    meta.appendChild(more)
  }
  el.appendChild(meta)

  // 正文容器
  const wrap = document.createElement('div')
  if (it.externalOnly) {
    // 视频等壳：与普通卡片同壳，顶行仍放反馈按钮
    wrap.className = 'card'
    const top = document.createElement('div')
    top.className = 'card-top'
    const tag = document.createElement('span')
    tag.className = 'item-kind'
    tag.textContent = it.kind ?? '视频'
    top.appendChild(tag)
    top.appendChild(feedbackRow((act, a, btn) => handleDiscard(el, onNav, act, btn), it))
    wrap.appendChild(top)
    if (it.author) wrap.appendChild(authorBlock(it.author))
    const p = document.createElement('p')
    p.className = 'muted'
    p.textContent = '该类型暂不能在站内直接阅读。'
    wrap.appendChild(p)
    if (it.url) {
      const a = document.createElement('a')
      a.href = it.url
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      a.textContent = '在知乎打开 ↗'
      wrap.appendChild(a)
    }
  } else {
    const card = answerCard(it, {
      onComment: (a, btn, cardEl) => {
        const mt = a.machineType ?? 'answer'
        if (mt === 'pin') {
          document.dispatchEvent(new CustomEvent('minizhi:toast', { detail: '想法的评论暂不支持' }))
          return
        }
        const aid = a.answerId || a.id
        if (!aid) return
        if (mt === 'article') openComments('article', aid, cardEl, btn)
        else openComments('answer', aid, cardEl, btn)
      },
      onDiscard: (act, a, btn) => handleDiscard(el, onNav, act, btn),
    })
    wrap.appendChild(card)
  }
  el.appendChild(wrap)

  // 底部导航
  const nb = navBar({
    onPrev: async () => {
      if (store.index > 0) {
        store.index--
        renderItemView(el, onNav, true)
        scrollToCard(el)
      }
    },
    onNext: async () => {
      if (store.index + 1 < store.items.length) {
        store.index++
        renderItemView(el, onNav, true)
        scrollToCard(el)
        return
      }
      if (!store.nextUrl || store.loading) {
        if (!store.nextUrl) document.dispatchEvent(new CustomEvent('minizhi:toast', { detail: '没有更多了' }))
        return
      }
      // 尾部：自动续页后前进
      try {
        await appendMore()
        if (store.index + 1 < store.items.length) {
          store.index++
          renderItemView(el, onNav, true)
          scrollToCard(el)
        }
      } catch (err) {
        document.dispatchEvent(new CustomEvent('minizhi:error', { detail: { err } }))
      }
    },
  })
  el.appendChild(nb.bar)

  // 尾部自动续页
  if (store.nextUrl && store.index >= store.items.length - 3 && !store.loading) {
    appendMore().catch((err) =>
      document.dispatchEvent(new CustomEvent('minizhi:error', { detail: { err } }))
    )
  }
}

export function mount(container) {
  const el = document.createElement('div')
  container.appendChild(el)
  const view = {
    async refresh() {
      try {
        await loadFirst({ fresh: true })
        renderItemView(el, () => {})
      } catch (err) {
        document.dispatchEvent(new CustomEvent('minizhi:error', { detail: { err } }))
      }
    },
    async step(d) {
      if (d > 0) {
        const btn = el.querySelector('.navbar .btn-primary')
        btn?.click()
      } else {
        const prev = el.querySelector('.navbar .btn:not(.btn-primary)')
        prev?.click()
      }
    },
    onFirstPaint: async () => {
      try {
        await loadFirst()
        renderItemView(el, () => {})
      } catch (err) {
        document.dispatchEvent(new CustomEvent('minizhi:error', { detail: { err } }))
      }
    },
  }
  view.onFirstPaint()
  return view
}
