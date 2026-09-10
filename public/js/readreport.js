// readreport.js —— 已读上报：告诉知乎「这条我看过了」，减少推荐流重复推同一条
//
// 实测口径（2026-09，chrome 抓网页版 + zhihu-plus-plus 源码对照）：
//   · 推荐流卡片曝光 → POST /lastread/touch
//       multipart/form-data，字段 items = [["answer","3613977568","touch"],["post","2081400426830869253","touch"]]
//       实测网页版把「文章」报成 post（该 id 经 /api/v4/articles 确认为 article）
//   · 打开内容（问题页）→ POST /api/v4/read_history/add，JSON {"content_token":"<id>","content_type":"question"}
//   · zhihu-plus-plus 点开内容 → /lastread/touch，动词用 "read"
//
// 我们的策略：只报「真正显示给用户看的那一条」（不报仅加载进内存的）；
// 同一内容每次会话只报一次；曝光立即入队，read 要停留够久才算；
// 队列攒几秒合并成一个请求发出（省请求、别触发风控）；失败静默，不影响阅读。
import { api } from './api.js'

const ZH = 'https://www.zhihu.com'
/** /lastread/touch 的类型名（照网页版：文章也叫 post） */
const TOUCH_TYPE = { answer: 'answer', article: 'post', pin: 'pin', question: 'question', zvideo: 'zvideo' }
/** /api/v4/read_history/add 的类型名（照 zhihu-plus-plus） */
const HISTORY_TYPE = { answer: 'answer', article: 'article', pin: 'pin', question: 'question' }
const FLUSH_MS = 4000

const sent = new Set()
const queue = []
let timer = null
let flushing = false

function describe(item) {
  if (!item) return null
  const kind = item.machineType ?? item.rawType ?? 'answer'
  const id = item.id != null && item.id !== '' ? String(item.id) : ''
  return id ? { kind, id } : null
}

function schedule() {
  if (timer || flushing || queue.length === 0) return
  timer = setTimeout(() => {
    timer = null
    flush()
  }, FLUSH_MS)
}

async function flush() {
  if (flushing || queue.length === 0) return
  flushing = true
  const batch = queue.splice(0)
  try {
    const boundary = '----MiniZhi' + Math.random().toString(36).slice(2)
    const body =
      `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="items"\r\n\r\n' +
      JSON.stringify(batch) +
      `\r\n--${boundary}--\r\n`
    await api.zh(`${ZH}/lastread/touch`, {
      method: 'POST',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'x-requested-with': 'fetch',
      },
      body,
    })
  } catch {
    /* 上报失败不影响阅读 */
  } finally {
    flushing = false
    schedule()
  }
}

function enqueue(item, verb) {
  const d = describe(item)
  const type = d && TOUCH_TYPE[d.kind]
  if (!type) return
  const key = `${verb}:${type}:${d.id}`
  if (sent.has(key)) return
  sent.add(key)
  queue.push([type, d.id, verb])
  schedule()
}

/** 这条内容出现在屏幕上了（曝光） */
export function noteExposure(item) {
  enqueue(item, 'touch')
}

/** 用户确实读了这条（停留够久，或主动打开了详情） */
export function noteRead(item) {
  enqueue(item, 'read')
  const d = describe(item)
  const type = d && HISTORY_TYPE[d.kind]
  if (!type) return
  api
    .zh(`${ZH}/api/v4/read_history/add`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch' },
      body: JSON.stringify({ content_token: d.id, content_type: type }),
    })
    .catch(() => {})
}

// 切到后台/关页面前尽量把这批发出去
document.addEventListener('visibilitychange', () => {
  if (document.hidden) flush()
})
