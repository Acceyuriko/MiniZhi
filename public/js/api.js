// api.js —— 与本地服务的所有通信
// 会话失效（HTTP 401）统一抛 SessionError，由 UI 弹横幅引导重新粘贴 cookie。
const ZH = 'https://www.zhihu.com'

export class SessionError extends Error {
  constructor(message) { super(message); this.name = 'SessionError' }
}

async function requestJson(url, opt = {}) {
  let res
  try {
    res = await fetch(url, opt)
  } catch (err) {
    throw new Error('本地服务连不上：' + err.message)
  }
  let data = {}
  try { data = await res.json() } catch { /* 非 JSON */ }
  if (res.status === 401) throw new SessionError(data.error || '登录已失效')
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

export const api = {
  session: () => requestJson('/api/session'),

  saveCookie: (cookie) =>
    requestJson('/api/session', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cookie }),
    }),

  clearCookie: () => requestJson('/api/session', { method: 'DELETE' }),

  me: () => requestJson('/api/me'),

  /** 白名单直通桥：知乎 API 原样转发（含评论/play_info 等），url 必须是 www.zhihu.com */
  zh: (url, { method = 'GET', headers = {}, body = null } = {}) =>
    requestJson('/api/zh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url, method, headers, body }),
    }),

  hot: () => requestJson('/api/zh', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: `${ZH}/api/v3/feed/topstory/hot-lists/total?limit=50&mobile=true` }),
  }),

  recommend: (limit = 20) =>
    requestJson('/api/zh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: `${ZH}/api/v3/feed/topstory/recommend?desktop=true&limit=${limit}` }),
    }),

  questionPage: (qid, { order = 'default', limit = 5 } = {}) =>
    requestJson(`/api/question/${qid}?order=${order}&limit=${limit}`),

  questionNext: (nextUrl, order = 'default') =>
    requestJson(`/api/question/next?url=${encodeURIComponent(nextUrl)}&order=${order}`),

  mediaUrl: (url) => '/media?url=' + encodeURIComponent(url),

  /** 评论：root = {type:'answer'|..., id} */
  comments: (type, id, { order = 'default', limit = 20 } = {}) =>
    api.zh(`${ZH}/api/v4/comment_v5/${type}s/${id}/root_comment?limit=${limit}&order_by=${order}`),

  childComments: (cid, { offset = 0, limit = 20 } = {}) =>
    api.zh(`${ZH}/api/v4/comment_v5/comment/${cid}/child_comment?limit=${limit}&offset=${offset}`),
}
