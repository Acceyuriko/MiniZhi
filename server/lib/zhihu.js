// zhihu.js —— 知乎网页 API 客户端
//
// 原则（与用户共识的风控预算）：
//   1. 所有请求走同一个串行队列，请求间隔 ≥ minGap（默认 1s），无轮询；
//   2. 每请求带齐：浏览器 UA、cookie、Referer、x-zse-93/x-zse-96 签名
//      （x-requested-with: fetch）；
//   3. 401/403 判定为“会话失效或签名被拒”，抛 SessionError，由上层提示用户
//      重新粘贴 cookie；不自动重试、不补偿性重放。
//
// 签名路径口径：参考实现默认把 query 也计入签名（signMode 'full'），但知乎
// 官方 JS 只签 pathname（'path'）。哪种被服务端接受用真实请求实测后固定，
// 见 /api/probe/me 与 session.js 的 signMode 字段。

import { cookieValue, loadSession } from './session.js'
import { zseHeaders } from './zse.js'

const BASE = 'https://www.zhihu.com'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

/** 会话类错误：需要用户重新粘贴 cookie */
export class SessionError extends Error {
  constructor(status, detail) {
    super(`知乎会话问题（HTTP ${status}）：${detail}`)
    this.status = status
  }
}

/** 其他请求失败（网络、限流、知乎侧错误） */
export class ZhihuError extends Error {
  constructor(status, detail) {
    super(`知乎请求失败（HTTP ${status}）：${detail}`)
    this.status = status
  }
}

/** 串行队列 + 最小间隔，兑现“请求串行化、≥1s 间隔”的风控预算 */
class RateLimiter {
  constructor(minGapMs = 1000) {
    this.minGapMs = minGapMs
    this.chain = Promise.resolve()
    this.lastAt = 0
  }

  run(fn) {
    const job = this.chain.then(async () => {
      const wait = Math.max(0, this.minGapMs - (Date.now() - this.lastAt))
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      try {
        return await fn()
      } finally {
        this.lastAt = Date.now()
      }
    })
    // 队列自身不因单个请求失败而断链
    this.chain = job.then(() => {}, () => {})
    return job
  }
}

const limiter = new RateLimiter()

/**
 * 纯页面 GET（无签名！实测：HTML 页面请求带签名头反而 404）。
 * 用于抓 SSR 问题页等。同样走风控队列。
 */
export async function plainGetText(url, { referer = 'https://www.zhihu.com/' } = {}) {
  const session = loadSession()
  return limiter.run(async () => {
    const res = await fetch(url, {
      headers: {
        'user-agent': UA,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        referer,
        ...(session?.cookie ? { cookie: session.cookie } : {}),
      },
    })
    const text = await res.text()
    if (!res.ok) throw new ZhihuError(res.status, '页面抓取失败 ' + text.slice(0, 120))
    return text
  })
}

/**
 * 知乎的雪花 ID（问题/回答/文章/用户）经常超过 JS 安全整数 2^53，JSON.parse
 * 会悄悄丢精度，之后用它拼请求 URL 就全错（如 2080685915270296000 会被舍入）。
 * 解决办法：解析前把字符串之外的 ≥16 位整数字面量包成字符串（这类字段全是
 * ID，本就是当字符串用的；计数/时间戳都是小整数，不受影响）。
 * 实现上用一个带引号状态的小扫描器，绝不碰字符串内容（推荐流里有的字段
 * 内嵌转义 JSON，如 "brief": "{...\"id\": 2081117250409459755}"）。
 */
export function parseZhihuJson(text) {
  let out = ''
  let inStr = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      out += ch
      if (ch === '\\' && i + 1 < text.length) {
        out += text[i + 1]
        i++
      } else if (ch === '"') {
        inStr = false
      }
      continue
    }
    if (ch === '"') {
      inStr = true
      out += ch
      continue
    }
    if (ch === '-' || (ch >= '0' && ch <= '9')) {
      let k = i
      if (ch === '-') k++
      while (k < text.length && text[k] >= '0' && text[k] <= '9') k++
      const digits = k - (ch === '-' ? i + 1 : i)
      const token = text.slice(i, k)
      out += digits >= 16 ? `"${token}"` : token
      i = k - 1
      continue
    }
    out += ch
  }
  return JSON.parse(out)
}

function buildHeaders(extra = {}) {
  const session = loadSession()
  const dc0 = cookieValue('d_c0')
  const headers = {
    'user-agent': UA,
    accept: 'application/json, text/plain, */*',
    referer: 'https://www.zhihu.com/',
    ...(session?.cookie ? { cookie: session.cookie } : {}),
  }
  if (dc0) {
    Object.assign(headers, zseHeaders({ url: extra.__url, dc0, pathOnly: session?.signMode === 'path' }))
  }
  delete extra.__url
  return headers
}

/**
 * 发起一次签名请求（GET 语义，POST 由调用方指定 body）。
 * @param {string} pathAndQuery 如 /api/v4/me 或 /api/v3/feed/topstory/hot-lists/total?limit=50
 * @param {object} [opts] { method, body, headers } —— headers 为额外请求头
 *   （如 play_info 需要 x-app-za/x-referer/content-type）
 */
export function request(pathAndQuery, { method = 'GET', body = null, headers = {} } = {}) {
  const url = BASE + pathAndQuery
  return limiter.run(async () => {
    const res = await fetch(url, {
      method,
      headers: { ...buildHeaders({ __url: url }), ...headers },
      body,
      redirect: 'follow',
    })
    const text = await res.text()
    if (res.status === 401 || res.status === 403) {
      // 10003「请求参数异常」是知乎侧偶发拒绝，不是登录态失效
      //（2026-09 实测：同参数重发 8/8 全 200）→ 走 ZhihuError，别提示重贴 cookie
      if (text.includes('"code":10003')) {
        throw new ZhihuError(res.status, '临时拒绝（10003 请求参数异常），稍后重试：' + text.slice(0, 300))
      }
      throw new SessionError(res.status, text.slice(0, 300))
    }
    if (!res.ok) {
      throw new ZhihuError(res.status, text.slice(0, 300))
    }
    try {
      return parseZhihuJson(text)
    } catch {
      throw new ZhihuError(res.status, '响应不是 JSON（前 200 字）：' + text.slice(0, 200))
    }
  })
}

/** 当前登录人信息（GET /api/v4/me） */
export async function me() {
  const json = await request('/api/v4/me')
  return {
    name: json.name,
    urlToken: json.url_token,
    headline: json.headline,
    isBaned: json.is_baned,
  }
}

/**
 * 实测两种签名口径哪个被服务端接受（同一请求路径分别用 full/path 各发一次）。
 * 返回 { full, path }，值为 { ok, status, detail }。
 */
export async function probeSignMode() {
  const results = {}
  for (const mode of ['full', 'path']) {
    const url = BASE + '/api/v4/me'
    const dc0 = cookieValue('d_c0')
    const headers = {
      'user-agent': UA,
      accept: 'application/json, text/plain, */*',
      referer: 'https://www.zhihu.com/',
      cookie: loadSession()?.cookie ?? '',
      ...zseHeaders({ url, dc0: dc0 ?? '', pathOnly: mode === 'path' }),
    }
    try {
      const res = await fetch(url, { method: 'GET', headers })
      const text = await res.text()
      let name = null
      if (res.ok) {
        try {
          name = JSON.parse(text).name
        } catch {
          // 保持 null
        }
      }
      results[mode] = { ok: res.ok, status: res.status, name, detail: res.ok ? '' : text.slice(0, 120) }
    } catch (err) {
      results[mode] = { ok: false, status: 0, detail: String(err) }
    }
  }
  return results
}
