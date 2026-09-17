// question.js —— 问题页视图：标题 + 排序切换 + 单回答阅读 + 定位来源回答
import { api, SessionError } from '../api.js'
import { answerCard, navBar } from '../ui.js'
import { fmtTime, fillContent } from '../render.js'
import { openComments } from '../comments.js'
import * as discard from '../discard.js'
import * as report from '../readreport.js'

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
  located: '', // 已经定位过的来源回答 id（同一个问题换回答链接时要重新定位）
}

async function loadFirstPage(qid, sort) {
  store.loading = true
  try {
    const page = await api.questionPage(qid, { order: sort, limit: 5 })
    store.question = page.question
    store.items = discard.filterList(page.answers ?? [])
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
    let added = 0
    for (let i = 0; i < 3; i++) {
      if (!store.nextUrl) break
      const page = await api.questionNext(store.nextUrl, store.sort)
      const items = discard.filterList(page.answers ?? [])
      store.items.push(...items)
      added += items.length
      store.nextUrl = page.nextUrl
      if (items.length > 0 || !store.nextUrl) break
    }
    return added > 0
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

/** 翻页后平滑滚动到回答卡片（避开顶栏），不回到页面顶部 */
function scrollToCard(el) {
  requestAnimationFrame(() => {
    const card = el.querySelector('.card')
    card?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  })
}

const READ_DWELL_MS = 15000
let readTimer = null

/** 当前展示的回答：立即报曝光，停留够久再报已读（切走就不算读过） */
function trackCurrent(it) {
  clearTimeout(readTimer)
  report.noteExposure(it)
  readTimer = setTimeout(() => {
    if (store.items[store.index]?.id === it.id) report.noteRead(it)
  }, READ_DWELL_MS)
}

/** 不喜欢该内容 / 不看该作者：与推荐流同一套本地黑名单 + 云端反馈 */
async function handleDiscard(el, act, btn) {
  const it = store.items[store.index]
  if (!it) return
  if (btn) btn.disabled = true
  if (act === 'author' && !it.author) {
    document.dispatchEvent(new CustomEvent('minizhi:toast', { detail: '这条回答没有作者信息' }))
    return
  }
  const res = await discard.applyDiscard(it, act)
  if (res?.err instanceof SessionError) {
    document.dispatchEvent(new CustomEvent('minizhi:error', { detail: { err: res.err } }))
  }
  if (act === 'author') {
    store.items = store.items.filter((x) => !discard.isAuthorBlocked(x))
  } else {
    store.items.splice(store.index, 1)
  }
  if (store.index >= store.items.length) {
    store.index = Math.max(0, store.items.length - 1)
  }
  render(el)
  scrollToCard(el)
  document.dispatchEvent(
    new CustomEvent('minizhi:toast', { detail: discard.discardToast(res, act) })
  )
}

function render(el) {
  el.innerHTML = ''
  const it = store.items[store.index]

  // 头部：返回（按钮：动作而非导航）+ 问题标题 + 计数
  const back = document.createElement('button')
  back.type = 'button'
  back.className = 'back-link'
  back.textContent = '返回'
  back.setAttribute('aria-label', '返回上一页')
  back.addEventListener('click', () => {
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
    // 问题描述全文展示（不截断）
    const d = document.createElement('div')
    d.className = 'content-body'
    d.style.cssText = 'font-size:16px;margin:2px 0 4px;'
    fillContent(d, store.question.detail)
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
      await view.refresh() // refresh 内部已 render
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
    // 当前页被筛空（屏蔽/无回答）但还有下一页 → 自动续页后再画
    if (store.nextUrl && !store.loading) {
      el.innerHTML = '<div class="loading spin">加载回答…</div>'
      appendMore()
        .then(() => render(el))
        .catch((err) =>
          document.dispatchEvent(new CustomEvent('minizhi:error', { detail: { err } }))
        )
      return
    }
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
    onComment: (a, btn, cardEl) => {
      if (a.id) openComments('answer', a.id, cardEl, btn)
    },
    onDiscard: (act, a, btn) => handleDiscard(el, act, btn),
  })
  el.appendChild(card)

  // 已读上报：当前这条算曝光，停留够久再算已读
  trackCurrent(it)

  const nb = navBar({
    prevText: '◀ 上一个回答',
    nextText: '下一个回答 ▶',
    onFirst: () => {
      if (store.index === 0) {
        document.dispatchEvent(new CustomEvent('minizhi:toast', { detail: '已经是第一个回答' }))
        return
      }
      store.index = 0
      render(el)
      scrollToCard(el)
    },
    onPrev: () => {
      if (store.index > 0) {
        store.index--
        render(el)
        scrollToCard(el)
      } else {
        document.dispatchEvent(new CustomEvent('minizhi:toast', { detail: '已经是第一个回答' }))
      }
    },
    onNext: async () => {
      if (store.index + 1 < store.items.length) {
        store.index++
        render(el)
        scrollToCard(el)
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
          render(el)
          scrollToCard(el)
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
      if (d > 0) el.querySelector('.navbar .nav-next')?.click()
      else el.querySelector('.navbar .nav-prev')?.click()
    },
    onFirstPaint: () => {
      const key = `${qid}/${sort}`
      const sameQuestion = store.qid === qid
      // 有 from（点了某条回答/粘贴了回答链接）就必须定位到它；重复进同一个回答才续看
      if (store.key === key && store.items.length > 0 && (!from || String(from) === store.located)) {
        render(el) // 会话级：同 qid+sort 直接续看
        return
      }
      store.qid = qid
      store.sort = sort
      store.key = key
      store.located = from ? String(from) : ''
      store.items = []
      store.nextUrl = null
      store.question = null
      store.index = 0
      store.note = ''
      // 打开问题页 = 读过这个问题（照网页版：read_history/add content_type=question）
      report.noteRead({ machineType: 'question', id: String(qid) })
      view.refresh()
    },
  }
  view.onFirstPaint()
  return view
}
