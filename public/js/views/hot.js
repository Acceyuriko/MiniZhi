// hot.js —— 全站热榜视图（50 条，手动刷新，点击进问题页）
import { api } from '../api.js'
import { esc } from '../render.js'

export const store = { items: [], updatedAt: 0 }

function normalize(item) {
  const t = item?.target ?? {}
  if (t.type !== 'question') return null
  // 知乎热榜数据不稳定：有的条目 url 字段为空。id 走 url 提取优先，
  // 缺失时回退 target.id（本地解析器已把超长数字保精度转成字符串）
  const qid =
    String((String(t.url ?? '').match(/\/question\/(\d+)/) ?? [])[1] ?? '') ||
    String(t.id ?? '')
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
    ul.setAttribute('aria-label', '知乎热榜')
    store.items.forEach((it, i) => {
      const li = document.createElement('li')
      // 整行是一条 <a>（可键盘聚焦、可中键新开、可复制链接）
      const row = document.createElement(it.qid ? 'a' : 'span')
      row.className = 'hot-row'
      if (it.qid) row.href = '#question/' + it.qid
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
      sub.textContent = bits.join(' · ')
      title.appendChild(sub)
      row.appendChild(rank)
      row.appendChild(title)
      if (it.heat != null) {
        const heat = document.createElement('span')
        heat.className = 'hot-heat'
        heat.textContent = String(it.heat)
        row.appendChild(heat)
      }
      li.appendChild(row)
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
