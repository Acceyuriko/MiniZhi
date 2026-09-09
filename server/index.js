// index.js —— MiniZhi 本地服务入口
// 单进程干四件事：静态页面、会话（cookie）管理、知乎 API 代理（带签名）、资源代理（后续）。
// 默认只监听 127.0.0.1（本机自用），端口可用环境变量 PORT 覆盖。
//
// 路由一览（v1 进度）：
//   GET  /                      静态首页（public/）
//   GET  /api/session           当前会话状态（是否已粘贴 cookie、签名口径）
//   PUT  /api/session           粘贴 cookie  { cookie: '...' }
//   DELETE /api/session         清除会话
//   GET  /api/me                登录人信息（真实请求，验证签名是否被接受）
//   GET  /api/probe/me          实测 full/path 两种签名口径（一次性诊断）

import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as session from './lib/session.js'
import * as zhihu from './lib/zhihu.js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const PUBLIC_DIR = path.join(ROOT, 'public')
const PORT = Number(process.env.PORT || 8787)
const HOST = process.env.HOST || '127.0.0.1'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

// 知乎路径白名单前缀：直通桥只放行这些（防开放代理穿透）
const ZHIHU_ALLOWED_PREFIXES = [
  '/api/v4/me',
  '/api/v3/feed/topstory/hot-lists/',
  '/api/v3/feed/topstory/recommend',
  '/api/v4/questions/',
  '/api/v4/answers/',
  '/api/v4/articles/',
  '/api/v4/pins/',
  '/api/v4/comment_v5/',
  '/api/v4/video/play_info',
  '/api/v4/members/',
]

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > 1_000_000) reject(new Error('body too large'))
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

function serveStatic(req, res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.slice(1)
  const file = path.join(PUBLIC_DIR, rel)
  if (!file.startsWith(PUBLIC_DIR) || !existsSync(file) || !statSync(file).isFile()) {
    sendJson(res, 404, { error: 'not found' })
    return
  }
  const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' })
  createReadStream(file).pipe(res)
}

async function handleApi(req, res, url) {
  const route = url.pathname
  try {
    if (route === '/api/session' && req.method === 'GET') {
      const s = session.loadSession()
      return sendJson(res, 200, {
        hasCookie: !!s?.cookie,
        savedAt: s?.savedAt ?? null,
        signMode: s?.signMode ?? 'full',
      })
    }

    if (route === '/api/session' && req.method === 'PUT') {
      const body = JSON.parse((await readBody(req)) || '{}')
      const cookie = String(body.cookie ?? '').trim()
      if (!cookie || cookie.indexOf('=') < 0) {
        return sendJson(res, 400, { error: 'cookie 看起来不对：应形如 name=value; name2=value2' })
      }
      const saved = session.saveSession(cookie)
      return sendJson(res, 200, { ok: true, signMode: saved.signMode })
    }

    if (route === '/api/session' && req.method === 'DELETE') {
      session.clearSession()
      return sendJson(res, 200, { ok: true })
    }

    if (route === '/api/me' && req.method === 'GET') {
      const info = await zhihu.me()
      return sendJson(res, 200, info)
    }

    if (route === '/api/probe/me' && req.method === 'GET') {
      if (!session.loadSession()?.cookie) {
        return sendJson(res, 400, { error: '请先粘贴 cookie' })
      }
      const results = await zhihu.probeSignMode()
      return sendJson(res, 200, results)
    }

    if (route === '/api/zh' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}')
      const target = String(body.url ?? '').trim()
      if (!session.loadSession()?.cookie) {
        return sendJson(res, 401, { error: '请先粘贴 cookie', hint: 'session' })
      }
      // 只放行 www.zhihu.com 且命中白名单前缀的请求
      const pathname = target.startsWith('https://www.zhihu.com/')
        ? target.slice('https://www.zhihu.com'.length)
        : null
      const allowed = pathname && ZHIHU_ALLOWED_PREFIXES.some((p) => pathname.startsWith(p))
      if (!allowed) {
        return sendJson(res, 400, { error: '只允许代理知乎白名单 API' })
      }
      const json = await zhihu.request(pathname, { method: body.method === 'POST' ? 'POST' : 'GET' })
      return sendJson(res, 200, json)
    }

    return sendJson(res, 404, { error: 'unknown api' })
  } catch (err) {
    if (err instanceof zhihu.SessionError) {
      return sendJson(res, 401, { error: err.message, hint: 'session' })
    }
    if (err instanceof zhihu.ZhihuError) {
      return sendJson(res, 502, { error: err.message })
    }
    console.error('[minizhi] api error:', err)
    return sendJson(res, 500, { error: String(err?.message ?? err) })
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`)
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch((err) => {
      console.error('[minizhi] unhandled:', err)
      if (!res.headersSent) sendJson(res, 500, { error: String(err?.message ?? err) })
    })
    return
  }
  serveStatic(req, res, url.pathname)
})

server.listen(PORT, HOST, () => {
  console.log(`[minizhi] MiniZhi 已启动: http://${HOST}:${PORT}`)
})
