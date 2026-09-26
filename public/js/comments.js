// comments.js —— 评论区（内联展开在回答卡片下方，不弹框）
// 打开/收起：openComments(type, id, anchor, btn)；同一时刻只展开一处。
import { api } from './api.js'
import { fillContent, fmtTime, esc } from './render.js'
import * as report from './readreport.js'

let open = null // { type, id, box, btn }

function cidOf(comment) {
  // 知乎后端会对超长数字自舍入：id 优先从 url 提取；
  // url 有两种形态（/comment/{id} 与 /comments/{id}），也可能缺失 → 回退 id 字段
  const m = String(comment?.url ?? '').match(/\/comments?\/(\d+)/)
  return m?.[1] ?? comment?.id ?? null
}

function errOut(err) {
  document.dispatchEvent(new CustomEvent('minizhi:error', { detail: { err } }))
}

const openLabel = '收起评论'

/** 展开/收起一处评论；anchor 为所属卡片元素，btn 为触发按钮 */
export function openComments(type, id, anchor, btn) {
  const key = `${type}:${id}`
  // 点同一个 → 收起
  if (open && open.box.isConnected && open.key === key) {
    closeComments()
    return
  }
  // 已开着别处 → 先收起（旧 box 可能已随视图重渲染断开，remove 是安全的）
  if (open) closeComments()

  // 点开评论说明这条内容确实在读 → 按已读上报（收起不算，所以放在这个位置之后）
  report.noteRead({ machineType: type, id: String(id) })

  const box = document.createElement('div')
  box.className = 'comments-inline'
  const head = document.createElement('div')
  head.className = 'comments-inline-head'
  const title = document.createElement('h3')
  title.textContent = '💬 评论'
  const closeBtn = document.createElement('button')
  closeBtn.className = 'btn btn-ghost btn-sm'
  closeBtn.textContent = '关闭'
  closeBtn.addEventListener('click', closeComments)
  head.appendChild(title)
  head.appendChild(closeBtn)
  box.appendChild(head)

  const list = document.createElement('div')
  box.appendChild(list)
  anchor.after(box)
  if (btn) {
    btn.textContent = openLabel
    btn.setAttribute('aria-expanded', 'true')
  }

  open = { key, type, id, box, list, btn }
  loadRoot(true).catch(errOut)
}

export function closeComments() {
  if (!open) return
  open.box.remove()
  if (open.btn) {
    open.btn.textContent = '💬 评论'
    open.btn.setAttribute('aria-expanded', 'false')
  }
  open = null
}

function commentEl(c, { child = false } = {}) {
  const el = document.createElement('div')
  el.className = 'comment'
  const author = c?.author ?? {}
  const head = document.createElement('div')
  const nm = document.createElement('span')
  nm.className = 'c-author'
  nm.textContent = author.name ?? '匿名用户'
  head.appendChild(nm)
  // 楼中楼回复他人时展示「回复 @xxx」（字段实测仅回复非根评论时存在）
  const replied = c?.reply_to_author?.name
  if (replied) {
    const r = document.createElement('span')
    r.className = 'c-reply'
    r.textContent = `回复 @${replied}`
    head.appendChild(r)
  }
  if (c?.created_time) {
    const t = document.createElement('span')
    t.className = 'c-time'
    t.textContent = fmtTime(c.created_time)
    head.appendChild(t)
  }
  // IP 属地：接口本来就带在 comment_tag 里（type=ip_info，text 是省名），不需额外请求
  const ip = (c?.comment_tag ?? []).find((t) => t?.type === 'ip_info')?.text
  if (ip) {
    const s = document.createElement('span')
    s.className = 'c-time'
    s.textContent = ip
    head.appendChild(s)
  }
  el.appendChild(head)

  const content = document.createElement('div')
  content.className = 'c-body'
  fillContent(content, c?.content ?? '')
  el.appendChild(content)

  const meta = document.createElement('div')
  meta.className = 'c-actions'
  meta.innerHTML = `<span>👍 ${c?.like_count ?? 0}</span>` +
    (c?.child_comment_count > 0 ? `<span>${c.child_comment_count} 条回复</span>` : '')
  el.appendChild(meta)

  if (!child && (c?.child_comment_count ?? 0) > 0) {
    const cid = cidOf(c)
    const box = document.createElement('div')
    box.className = 'c-children hidden'
    const btn = document.createElement('button')
    btn.className = 'btn btn-ghost btn-sm'
    btn.textContent = `展开 ${c.child_comment_count} 条回复`
    btn.setAttribute('aria-expanded', 'false')
    const updateLabel = () => {
      const collapsed = box.classList.contains('hidden')
      btn.textContent = collapsed ? `展开 ${c.child_comment_count} 条回复` : '收起回复'
      btn.setAttribute('aria-expanded', String(!collapsed))
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
        if (list.length === 0) {
          const none = document.createElement('div')
          none.className = 'muted'
          none.textContent = '暂无回复'
          box.appendChild(none)
        }
        for (const cc of list) {
          const childEl = commentEl(cc, { child: true })
          if (cidOf(cc) && (cc?.child_comment_count ?? 0) > 0) {
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

/** 加载第一页（或续页）到 open.list */
async function loadRoot(reset) {
  if (!open) return
  if (!reset && !open.nextUrl) return
  const list = open.list
  if (reset) list.innerHTML = '<div class="loading spin">加载评论…</div>'
  try {
    let json
    if (reset) json = await api.comments(open.type, open.id)
    else json = await api.zh(open.nextUrl)
    if (!open || !list.isConnected) return // 用户已切换/收起
    if (reset) list.innerHTML = ''
    const items = json?.data ?? []
    for (const c of items) list.appendChild(commentEl(c))
    open.nextUrl = json?.paging?.next ?? ''
    if (open.nextUrl) {
      const more = document.createElement('button')
      more.className = 'btn loadmore'
      more.textContent = '加载更多评论'
      more.addEventListener('click', () => {
        more.remove()
        loadRoot(false).catch(errOut)
      })
      list.appendChild(more)
    } else if (reset && items.length === 0) {
      const none = document.createElement('div')
      none.className = 'empty'
      none.textContent = '还没有评论'
      list.appendChild(none)
    }
  } catch (err) {
    if (open?.list?.isConnected) errOut(err)
  }
}
