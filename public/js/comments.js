// comments.js —— 评论对话框（一级 + 楼中楼，只读，默认排序）
import { api } from './api.js'
import { fillContent, fmtTime, esc } from './render.js'

let current = null // { type:'answer'|'article'|'pin', id, rootNext, loading }

const dialog = () => document.getElementById('comments')
const body = () => document.getElementById('commentsBody')

function cidOf(comment) {
  // 知乎后端会对超长数字自舍入：id 优先从 url 提取；
  // url 有两种形态（/comment/{id} 与 /comments/{id}），也可能缺失 → 回退 id 字段
  const m = String(comment?.url ?? '').match(/\/comments?\/(\d+)/)
  return m?.[1] ?? comment?.id ?? null
}

function errOut(err) {
  document.dispatchEvent(new CustomEvent('minizhi:error', { detail: { err } }))
}

export function openComments(type, id) {
  current = { type, id, rootNext: null, loading: false }
  dialog().showModal()
  loadRoot(true)
}

function closeComments() {
  dialog().close()
  current = null
}

function commentEl(c, { child = false } = {}) {
  const el = document.createElement('div')
  el.className = 'comment'
  const author = c?.author ?? {}
  const head = document.createElement('div')
  head.innerHTML = `<span class="c-author">${esc(author.name ?? '匿名用户')}</span>` +
    (author.headline ? `<span class="c-author muted">${esc(author.headline)}</span>` : '')
  el.appendChild(head)

  const content = document.createElement('div')
  content.className = 'c-body'
  fillContent(content, c?.content ?? '', {
    onVideo: () => errOut(new Error('评论内视频暂不支持')),
  })
  el.appendChild(content)

  const meta = document.createElement('div')
  meta.className = 'c-actions'
  meta.innerHTML = `<span>${c?.like_count ?? 0} 赞</span>` +
    (c?.created_time ? `<span>${fmtTime(c.created_time)}</span>` : '') +
    (c?.child_comment_count > 0 ? `<span>${c.child_comment_count} 条回复</span>` : '')
  el.appendChild(meta)

  if (!child && (c?.child_comment_count ?? 0) > 0) {
    const cid = cidOf(c)
    const box = document.createElement('div')
    box.className = 'c-children hidden'
    const btn = document.createElement('button')
    btn.className = 'ghost'
    btn.textContent = `展开 ${c.child_comment_count} 条回复`
    const updateLabel = () => {
      btn.textContent = box.classList.contains('hidden')
        ? `展开 ${c.child_comment_count} 条回复`
        : '收起回复'
    }
    btn.addEventListener('click', async () => {
      const willOpen = box.classList.contains('hidden')
      if (!willOpen) {
        box.classList.add('hidden')
        updateLabel()
        return
      }
      if (!cid) return
      box.classList.remove('hidden')
      updateLabel()
      if (box.dataset.loaded === '1') return
      btn.disabled = true
      try {
        const json = await api.childComments(cid)
        box.dataset.loaded = '1'
        const list = json?.data ?? []
        if (list.length === 0) box.innerHTML = '<div class="muted">暂无回复</div>'
        for (const cc of list) {
          const childEl = commentEl(cc, { child: true })
          const ccid = cidOf(cc)
          if (ccid && (cc?.child_comment_count ?? 0) > 0) {
            const note = document.createElement('div')
            note.className = 'muted'
            note.textContent = '… 该回复下还有更深楼层，暂不展开'
            childEl.appendChild(note)
          }
          box.appendChild(childEl)
        }
      } catch (err) {
        errOut(err)
        box.classList.add('hidden')
        updateLabel()
      } finally {
        btn.disabled = false
        updateLabel()
      }
    })
    el.appendChild(btn)
    el.appendChild(box)
  }
  return el
}

async function loadRoot(reset) {
  if (!current || current.loading) return
  current.loading = true
  const holder = body()
  if (reset) {
    holder.innerHTML = '<div class="loading">加载评论…</div>'
  }
  try {
    let json
    if (reset) {
      json = await api.comments(current.type, current.id)
    } else if (current.rootNext) {
      json = await api.zh(current.rootNext)
    } else {
      return
    }
    if (reset) holder.innerHTML = ''
    const list = json?.data ?? []
    for (const c of list) holder.appendChild(commentEl(c))
    current.rootNext = json?.paging?.next ?? ''
    const end = json?.paging?.is_end !== false && !current.rootNext
    if (!end) {
      const more = document.createElement('button')
      more.className = 'loadmore'
      more.textContent = '加载更多评论'
      more.addEventListener('click', () => {
        more.remove()
        loadRoot(false)
      })
      holder.appendChild(more)
    } else if (reset && list.length === 0) {
      holder.innerHTML = '<div class="empty">还没有评论</div>'
    }
  } catch (err) {
    if (reset) holder.innerHTML = ''
    errOut(err)
  } finally {
    current.loading = false
  }
}

export function initComments() {
  document.getElementById('commentsClose').addEventListener('click', closeComments)
  dialog().addEventListener('click', (e) => {
    if (e.target === dialog()) closeComments()
  })
}
