// app.js —— MiniZhi 应用入口：hash 路由、会话横幅、全局快捷键
import { api, SessionError } from './api.js'
import { initComments } from './comments.js'
import * as recommend from './views/recommend.js'
import * as hot from './views/hot.js'
import * as question from './views/question.js'
import * as content from './views/content.js'

const viewEl = () => document.getElementById('view')
const bannerEl = () => document.getElementById('banner')
const toastEl = () => document.getElementById('toast')
const settingsEl = () => document.getElementById('settings')

let currentView = null
let currentRoute = { name: 'recommend' }
let toastTimer = null

// ── 全局事件：错误横幅 / 轻提示 ───────────────────────
function showBanner(msg, action) {
  const b = bannerEl()
  b.classList.remove('hidden')
  b.innerHTML = ''
  const span = document.createElement('span')
  span.textContent = msg
  b.appendChild(span)
  if (action) {
    const btn = document.createElement('button')
    btn.textContent = action.label
    btn.addEventListener('click', action.onClick)
    b.appendChild(btn)
  }
}

function hideBanner() {
  bannerEl().classList.add('hidden')
}

function toast(msg, ms = 2600) {
  const t = toastEl()
  t.textContent = msg
  t.classList.remove('hidden')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => t.classList.add('hidden'), ms)
}

function onError(err) {
  console.error('[minizhi]', err)
  if (err instanceof SessionError) {
    showBanner('登录已失效或未登录，MiniZhi 需要知乎 cookie 才能取数据', {
      label: '粘贴 cookie',
      onClick: () => settingsEl().showModal(),
    })
    setWho('未登录')
    return
  }
  const msg = String(err?.message ?? err)
  if (msg.length > 200) toast(msg.slice(0, 200) + '…', 4200)
  else toast(msg)
}

// ── 顶栏状态 ─────────────────────────────────────────
function setWho(text) {
  document.getElementById('who').textContent = text
}

async function refreshWho() {
  try {
    const me = await api.me()
    setWho(me.name ?? me.url_token ?? '已登录')
    hideBanner()
  } catch (err) {
    if (err instanceof SessionError) onError(err)
    // 其它错误：不打扰
  }
}

// ── 路由 ──────────────────────────────────────────────
function parseHash() {
  const h = location.hash.replace(/^#/, '')
  const [path, queryStr] = h.split('?')
  const seg = path.split('/').filter(Boolean)
  const q = new URLSearchParams(queryStr ?? '')
  if (seg[0] === 'question' && seg[1]) {
    return {
      name: 'question',
      qid: seg[1],
      sort: q.get('sort') === 'updated' ? 'updated' : 'default',
      from: q.get('from') || null,
    }
  }
  if (seg[0] === 'content' && seg[1] && seg[2]) {
    return { name: 'content', kind: seg[1], id: seg[2] }
  }
  if (seg[0] === 'hot') return { name: 'hot' }
  return { name: 'recommend' }
}

async function navigate() {
  const route = parseHash()
  currentRoute = route
  // Tab 高亮
  document.querySelectorAll('.tabs a').forEach((a) => {
    a.classList.toggle('active', a.dataset.tab === (route.name === 'question' || route.name === 'content' ? '' : route.name))
  })
  const container = viewEl()
  container.innerHTML = ''
  currentView = null
  if (route.name === 'recommend') {
    currentView = recommend.mount(container)
  } else if (route.name === 'hot') {
    currentView = hot.mount(container)
  } else if (route.name === 'question') {
    currentView = question.mount(container, {
      qid: route.qid,
      sort: route.sort,
      from: route.from,
    })
  } else if (route.name === 'content') {
    currentView = content.mount(container, { kind: route.kind, id: route.id })
  }
}

// ── 快捷键：←/→ 上下条（打字与弹窗时忽略） ──────────
function keydown(e) {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
  const tag = (e.target.tagName || '').toLowerCase()
  if (tag === 'textarea' || tag === 'input' || tag === 'select') return
  if (settingsEl().open || document.getElementById('comments').open) return
  const d = e.key === 'ArrowRight' ? 1 : -1
  if ((currentRoute.name === 'recommend' || currentRoute.name === 'question') && currentView) {
    e.preventDefault()
    currentView.step(d)
  }
}

// ── 登录对话框 ────────────────────────────────────────
function initSettings() {
  document.getElementById('who').addEventListener('click', () => settingsEl().showModal())

  const input = document.getElementById('cookieInput')
  const msg = document.getElementById('settingsMsg')
  const saveBtn = document.getElementById('cookieSave')

  saveBtn.addEventListener('click', async () => {
    const cookie = input.value.trim()
    if (!cookie) {
      msg.textContent = 'Cookie 不能为空'
      return
    }
    saveBtn.disabled = true
    msg.textContent = '保存中…'
    try {
      await api.saveCookie(cookie)
      await refreshWho()
      msg.textContent = ''
      settingsEl().close()
      hideBanner()
      toast('登录已保存')
      currentView?.refresh?.()
    } catch (err) {
      msg.textContent = '校验失败：' + (err?.message ?? err)
      saveBtn.disabled = false
    }
  })
}

// ── 启动 ──────────────────────────────────────────────
async function boot() {
  initComments()
  initSettings()

  document.getElementById('btnRefresh').addEventListener('click', () => {
    currentView?.refresh?.()
  })

  // 会话状态
  api
    .session()
    .then((s) => {
      if (!s?.hasCookie) {
        setWho('未登录')
        showBanner('还没有知乎 cookie，先粘贴一个才能看内容', {
          label: '粘贴 cookie',
          onClick: () => settingsEl().showModal(),
        })
      } else {
        refreshWho()
      }
    })
    .catch(() => setWho('未登录'))

  document.addEventListener('minizhi:error', (e) => onError(e.detail?.err))
  document.addEventListener('minizhi:toast', (e) => toast(e.detail))

  window.addEventListener('hashchange', navigate)
  document.addEventListener('keydown', keydown)
  await navigate()
}

boot()
