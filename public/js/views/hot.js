// hot.js —— 全站热榜视图（50 条，手动刷新，点击进问题页）
import { api } from './api.js'
import { esc } from '../render.js'

export const store = { items: [], updatedAt: 0 }

function normalize(item) {
  const t = item?.target ?? {}
  if (t.type !== 'question') return null
  const qid = String((String(t.url ?? '').match(/\/question\/(\d+)/) ?? [])[1] ?? '')
  if (!qid) return null
  return {
    qid,
    title: t.title ?? '',
    excerpt: t.excerpt ?? '',
    answerCount: t.answer_count ?? t.answerCount,
    followerCount: t.follower_count ?? t.followerCount,
    heat: t.heat ?? t.hot_value ?? null,
  }
}

async function load() {
  const json = await api.hot()
  const items = (json.data ?? []).map(normalize).filter(Boolean)
  if (items.length === 0) throw new Error('热榜为空')
  store.items = items
  store.updatedAt = Date.now()
}

export function mount(container) {
  const el = document.createElement('div')
  container.appendChild(el)

  function paint() {
    el.innerHTML = ''
    const head = document.createElement('div')
    head.className = 'reader-meta'
    head.innerHTML = `<span>全站热榜 ${store.items.length} 条</span>` +
      (store.updatedAt ? `<span>更新于 ${new Date(store.updatedAt).toLocaleTimeString()}</span>` : '')
    el.appendChild(head)

    const ul = document.createElement('ul')
    ul.className = 'hot-list'
    store.items.forEach((it, i) => {
      const li = document.createElement('li')
      const rank = document.createElement('span')
      rank.className = 'hot-rank' + (i < 3 ? ' top3' : '')
      rank.textContent = String(i + 1).padStart(2, '0')
      const title = document.createElement('span')
      title.className = 'hot-title'
      title.textContent = it.title
      const sub = document.createElement('small')
      const bits = []
      if (it.answerCount != null) bits.push(`${it.answerCount} 回答`)
      if (it.followerCount != null) bits.push(`${it.followerCount} 关注`)
      if (it.heat != null) bits.push(`热度 ${it.heat}`)
      if (it.excerpt) bits.push(it.excerpt)
      sub.textContent = bits.join(' · ')
      title.appendChild(sub)
      li.appendChild(rank)
      li.appendChild(title)
      if (it.heat != null) {
        const heat = document.createElement('span')
        heat.className = 'hot-heat'
        heat.textContent = String(it.heat)
        li.appendChild(heat)
      }
      li.addEventListener('click', () => {
        location.hash = '#question/' + it.qid
      })
      ul.appendChild(li)
    })
    el.appendChild(ul)
  }

  const view = {
    async refresh() {
      try {
        el.innerHTML = '<div class="loading spin">加载热榜…</div>'
        await load()
        paint()
      } catch (err) {
        el.innerHTML = ''
        document.dispatchEvent(new CustomEvent('minizhi:error', { detail: { err } }))
      }
    },
    step() {},
    onFirstPaint() {
      if (store.items.length) {
        paint()
        return
      }
      view.refresh()
    },
  }
  view.onFirstPaint()
  return view
}
