// recommend.js —— 推荐流视图：单条大卡片、会话级记忆、尾部自动续页
import { api, SessionError } from '../api.js'
import { answerCard, navBar, authorBlock } from '../ui.js'
import { esc, fmtTime, fillContent } from '../render.js'
import { playVideoIn } from '../video.js'
import { openComments } from '../comments.js'

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
    const items = (json.data ?? []).map(normalizeFeedItem).filter(Boolean)
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

/** 尾部续页（自动追加一页，不移动当前条目） */
async function appendMore() {
  if (!store.nextUrl || store.loading) return false
  store.loading = true
  try {
    const json = await api.zh(store.nextUrl)
    const items = (json.data ?? []).map(normalizeFeedItem).filter(Boolean)
    store.items.push(...items)
    store.nextUrl = json.paging?.next ?? null
    return items.length > 0
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

function renderItemView(el, onNav) {
  el.innerHTML = ''
  const it = store.items[store.index]
  if (!it) {
    el.innerHTML = '<div class="empty">没有内容，点右上角“刷新”试试</div>'
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
    // 视频等壳：作者 + 外链
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
    const onQuestion = (qid, aid) => {
      if (!qid) {
        window.open(it.url, '_blank')
        return
      }
      location.hash = `#question/${qid}` + (aid ? `?from=${aid}` : '')
      onNav?.()
    }
    const card = answerCard(it, {
      onComment: (a) => {
        const mt = a.machineType ?? 'answer'
        if (mt === 'pin') {
          document.dispatchEvent(new CustomEvent('minizhi:toast', { detail: '想法的评论暂不支持' }))
          return
        }
        const aid = a.answerId || a.id
        if (!aid) return
        openComments(mt === 'article' ? 'article' : 'answer', aid)
      },
      onQuestion,
    })
    wrap.appendChild(card)
  }
  el.appendChild(wrap)

  // 底部导航
  const nb = navBar({
    onPrev: async () => {
      if (store.index > 0) {
        store.index--
        renderItemView(el, onNav)
      }
    },
    onNext: async () => {
      if (store.index + 1 < store.items.length) {
        store.index++
        renderItemView(el, onNav)
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
          renderItemView(el, onNav)
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
