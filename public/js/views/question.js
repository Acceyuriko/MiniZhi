// question.js —— 问题页视图：标题 + 排序切换 + 单回答阅读 + 定位来源回答
import { api } from '../api.js'
import { answerCard, navBar } from '../ui.js'
import { fmtTime } from '../render.js'
import { openComments } from '../comments.js'

export const store = {
  qid: null,
  sort: 'default', // default=热度, updated=时间
  question: null,
  items: [],
  index: 0,
  nextUrl: null,
  loading: false,
  note: '',
  key: '', // 唯一键：qid/sort 变了就重载
}

async function loadFirstPage(qid, sort) {
  store.loading = true
  try {
    const page = await api.questionPage(qid, { order: sort, limit: 5 })
    store.question = page.question
    store.items = page.answers ?? []
    store.nextUrl = page.nextUrl
    store.index = 0
    if (store.items.length === 0) store.note = '暂无回答'
  } finally {
    store.loading = false
  }
}

async function appendMore() {
  if (!store.nextUrl || store.loading) return false
  store.loading = true
  try {
    const page = await api.questionNext(store.nextUrl, store.sort)
    store.items.push(...(page.answers ?? []))
    store.nextUrl = page.nextUrl
    return (page.answers ?? []).length > 0
  } finally {
    store.loading = false
  }
}

/** 定位来源回答：当前页没有就续页找，上限 5 页，失败回退从头并给提示 */
async function locate(fromAid, maxPages = 5) {
  if (!fromAid) return
  const target = String(fromAid)
  let found = store.items.findIndex((a) => String(a.id) === target)
  let pages = 0
  while (found < 0 && store.nextUrl && pages < maxPages) {
    try {
      await appendMore()
    } catch (err) {
      document.dispatchEvent(new CustomEvent('minizhi:error', { detail: { err } }))
      break
    }
    found = store.items.findIndex((a) => String(a.id) === target)
    pages++
  }
  if (found >= 0) {
    store.index = found
  } else {
    store.index = 0
    store.note = '没找到来源回答（已翻 ' + pages + ' 页），从第一回答开始看'
  }
}

function render(el) {
  el.innerHTML = ''
  const it = store.items[store.index]

  // 头部：返回 + 问题标题 + 计数
  const back = document.createElement('a')
  back.className = 'back-link'
  back.textContent = '‹ 返回'
  back.href = '#'
  back.addEventListener('click', (ev) => {
    ev.preventDefault()
    history.back()
  })
  el.appendChild(back)

  const head = document.createElement('div')
  head.className = 'question-head'
  const title = document.createElement('h1')
  title.textContent = store.question?.title || '问题'
  head.appendChild(title)
  const meta = document.createElement('div')
  meta.className = 'muted'
  const bits = []
  if (store.question?.answerCount != null) bits.push(`${store.question.answerCount} 个回答`)
  if (store.question?.followerCount != null) bits.push(`${store.question.followerCount} 关注`)
  if (store.question?.commentCount != null) bits.push(`${store.question.commentCount} 评论`)
  meta.textContent = bits.join(' · ')
  head.appendChild(meta)
  if (store.question?.detail) {
    const d = document.createElement('div')
    d.className = 'content-body'
    const div = document.createElement('div')
    div.textContent = store.question.detail.replace(/<[^>]*>/g, '').slice(0, 400)
    d.appendChild(div)
    head.appendChild(d)
  }
  el.appendChild(head)

  // 排序 Tab
  const tabs = document.createElement('div')
  tabs.className = 'sort-tabs'
  for (const [key, label] of [['default', '按热度'], ['updated', '按时间']]) {
    const b = document.createElement('button')
    b.textContent = label
    b.className = store.sort === key ? 'active' : ''
    b.addEventListener('click', async () => {
      if (store.sort === key || store.loading) return
      store.sort = key
      store.key = `${store.qid}/${key}`
      store.items = []
      store.nextUrl = null
      store.question = null
      await view.refresh()
      render(el)
    })
    tabs.appendChild(b)
  }
  el.appendChild(tabs)

  if (store.note) {
    const note = document.createElement('div')
    note.className = 'muted'
    note.textContent = store.note
    el.appendChild(note)
  }

  if (!it) {
    const empty = document.createElement('div')
    empty.className = 'empty'
    empty.textContent = store.loading ? '加载中…' : '这个问题还没有可展示的回答'
    el.appendChild(empty)
    return
  }

  const prog = document.createElement('div')
  prog.className = 'reader-meta'
  prog.innerHTML = `<span>回答 ${store.index + 1} / ${store.items.length}${store.nextUrl ? '（还有更多，翻到底自动续）' : ' · 已到底'}</span>` +
    (it.updatedTime ? `<span>更新 ${fmtTime(it.updatedTime)}</span>` : '')
  el.appendChild(prog)

  const card = answerCard(it, {
    onComment: (a) => {
      if (a.id) openComments('answer', a.id)
    },
    onQuestion: () => {}, // 已处于问题页
  })
  el.appendChild(card)

  const nb = navBar({
    prevText: '◀ 上一个回答',
    nextText: '下一个回答 ▶',
    onPrev: () => {
      if (store.index > 0) {
        store.index--
        window.scrollTo({ top: 0 })
        render(el)
      } else {
        document.dispatchEvent(new CustomEvent('minizhi:toast', { detail: '已经是第一个回答' }))
      }
    },
    onNext: async () => {
      if (store.index + 1 < store.items.length) {
        store.index++
        window.scrollTo({ top: 0 })
        render(el)
        return
      }
      if (!store.nextUrl || store.loading) {
        if (!store.nextUrl)
          document.dispatchEvent(new CustomEvent('minizhi:toast', { detail: '没有更多回答了' }))
        return
      }
      try {
        await appendMore()
        if (store.index + 1 < store.items.length) {
          store.index++
          window.scrollTo({ top: 0 })
          render(el)
        }
      } catch (err) {
        document.dispatchEvent(new CustomEvent('minizhi:error', { detail: { err } }))
      }
    },
  })
  el.appendChild(nb.bar)

  // 尾部自动续页（预取）
  if (store.nextUrl && store.index >= store.items.length - 1 && !store.loading) {
    appendMore().catch((err) =>
      document.dispatchEvent(new CustomEvent('minizhi:error', { detail: { err } }))
    )
  }
}

export let view = null

export function mount(container, { qid, sort = 'default', from = null }) {
  const el = document.createElement('div')
  container.appendChild(el)

  view = {
    refresh: async () => {
      el.innerHTML = '<div class="loading spin">加载问题…</div>'
      try {
        await loadFirstPage(store.qid, store.sort)
        if (from && store.sort === 'default') await locate(from)
        render(el)
      } catch (err) {
        el.innerHTML = ''
        document.dispatchEvent(new CustomEvent('minizhi:error', { detail: { err } }))
      }
    },
    step(d) {
      if (d > 0) el.querySelector('.navbar .btn-primary')?.click()
      else el.querySelector('.navbar .btn:not(.btn-primary)')?.click()
    },
    onFirstPaint: () => {
      const key = `${qid}/${sort}`
      const sameQuestion = store.qid === qid
      if (store.key === key && store.items.length > 0) {
        render(el) // 会话级：同 qid+sort 直接续看
        return
      }
      store.qid = qid
      store.sort = sort
      store.key = key
      store.items = []
      store.nextUrl = null
      store.question = null
      store.index = 0
      store.note = ''
      view.refresh()
    },
  }
  view.onFirstPaint()
  return view
}
