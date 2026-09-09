// proxy.js —— 知乎图片/视频流本地代理
//
// 为什么需要：知乎的图片（pic*.zhimg.com）和视频 CDN 有防盗链，要求请求带
// Referer: https://www.zhihu.com/（以及必要时的 cookie）。浏览器里直接 <img src>
// 会 403，所以统一走后端取回再转给浏览器。
//
// 缓存策略（与用户共识）：只做进程内内存 LRU，不落盘。常规的磁盘缓存由
// 浏览器自己的 HTTP 缓存完成（代理 URL 稳定可缓存），服务端内存只为回看加速。
//
// 安全边界：只允许代理 zhimg.com / sns-video 等知乎媒体域名，不允许任意 URL
// 穿透（防止把本机变成开放代理）。

import { createHash } from 'node:crypto'

const ALLOWED_HOSTS = new Set([
  'pic1.zhimg.com',
  'pic2.zhimg.com',
  'pic3.zhimg.com',
  'pic4.zhimg.com',
  'pic5.zhimg.com',
  'picx.zhimg.com',
  'pica.zhimg.com',
  'picb.zhimg.com',
  'picc.zhimg.com',
  'sns-avatar.qhres.com', // 头像 CDN（部分场景）
  'video.zhimg.com',
  'vdn.appsimg.com', // 视频封面/流
  'appvdn.appsimg.com',
  'vdn.vzuu.com',
])

const CONTENT_HINTS = {
  '.mp4': 'video/mp4',
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

class MemoryLRU {
  constructor(maxBytes = 64 * 1024 * 1024) {
    this.maxBytes = maxBytes
    this.map = new Map() // key -> { bytes, contentType, at }
    this.size = 0
  }

  get(key) {
    const hit = this.map.get(key)
    if (!hit) return null
    this.map.delete(key)
    this.map.set(key, hit) // 移到末尾 = 最近使用
    return hit
  }

  put(key, bytes, contentType) {
    if (bytes.length > this.maxBytes) return // 单个体积超过上限就不缓存
    const existed = this.map.get(key)
    if (existed) this.size -= existed.bytes.length
    this.map.set(key, { bytes, contentType, at: Date.now() })
    this.size += bytes.length
    while (this.size > this.maxBytes && this.map.size > 1) {
      const oldest = this.map.keys().next().value
      this.size -= this.map.get(oldest).bytes.length
      this.map.delete(oldest)
    }
  }
}

const cache = new MemoryLRU()

/** 判断是否允许代理的知乎媒体 URL */
export function isAllowedMediaUrl(raw) {
  try {
    const u = new URL(raw)
    return (u.protocol === 'https:' || u.protocol === 'http:') && ALLOWED_HOSTS.has(u.hostname)
  } catch {
    return false
  }
}

function guessContentType(url) {
  try {
    const pathname = new URL(url).pathname.toLowerCase()
    for (const [suffix, type] of Object.entries(CONTENT_HINTS)) {
      if (pathname.endsWith(suffix)) return type
    }
  } catch {
    // 忽略
  }
  return null
}

/**
 * 拉取一个知乎媒体资源。
 * 视频/流类（.mp4/.m3u8/.ts）→ 流式透传（不缓存，浏览器边下边放）；
 * 图片等小资源 → 整块缓冲 + 内存 LRU。
 * @param {string} url 目标媒体 URL（限 ALLOWED_HOSTS）
 * @param {string|null} cookie 会话 cookie（视频流可能需要）
 * @returns {Promise<{status:number, contentType:string|null, fromCache:boolean,
 *                    body?:Buffer, stream?:import('node:stream').Readable}>}
 */
export async function fetchMedia(url, cookie) {
  if (!isAllowedMediaUrl(url)) {
    return { status: 403, contentType: 'text/plain; charset=utf-8', body: Buffer.from('forbidden host'), fromCache: false }
  }
  const key = createHash('sha1').update(url).digest('hex')
  const cached = cache.get(key)
  if (cached) {
    return { status: 200, contentType: cached.contentType, body: cached.bytes, fromCache: true }
  }
  const streaming = /\.(mp4|m3u8|ts)(\?|$)/i.test(url)
  const res = await fetch(url, {
    headers: {
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      referer: 'https://www.zhihu.com/',
      ...(cookie ? { cookie } : {}),
    },
  })
  if (!res.ok) {
    return { status: res.status, contentType: null, body: Buffer.from('upstream ' + res.status), fromCache: false }
  }
  const contentType = res.headers.get('content-type') || guessContentType(url)
  if (streaming) {
    return { status: 200, contentType, stream: res.body, fromCache: false }
  }
  const body = Buffer.from(await res.arrayBuffer())
  cache.put(key, body, contentType)
  return { status: 200, contentType, body, fromCache: false }
}
