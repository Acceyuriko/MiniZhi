// render.js —— 正文 HTML 清洗与富文本渲染工具
import { api } from './api.js'

const ZH = 'https://www.zhihu.com'

/** 相对时间（秒） */
export function fmtTime(unixSec) {
  if (!unixSec) return ''
  const d = new Date(unixSec * 1000)
  const diff = (Date.now() - unixSec * 1000) / 1000
  if (diff < 3600) return `${Math.max(1, Math.floor(diff / 60))} 分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} 天前`
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 正文 html → 可展示的文档片段（媒体转本地代理、站内链接转 hash 路由）
 *  注意：返回 doc.body 的“子节点们”而不是 body 本身——否则卡片里会嵌套
 *  <body> 元素，继承全局 body 样式出现一块白底。 */
export function renderContent(html, { onVideo } = {}) {
  const doc = new DOMParser().parseFromString(html, 'text/html')

  doc.querySelectorAll('script, iframe, form, style').forEach((el) => el.remove())

  // 图片：知乎用透明 SVG data URI 当懒加载占位（只为撑原图高度），
  // 真地址在 data-actualsrc / data-original / data-src 上 —— 必须换成真图，
  // 否则正文里全是大片空白；拿不到真地址的占位图直接删掉。
  //
  // SSR 同一图位会放两个 <img>：<noscript> 里的 no-JS 回退图 + 懒加载占位图。
  // DOMParser 脚本关闭时 noscript 子节点是真元素；塞回带脚本文档后 noscript
  // 又会变成 display:none —— 所以先把 noscript 拆开，再按 v2 token 去重，
  // 保证只留下一张可见图。
  doc.querySelectorAll('noscript').forEach((ns) => {
    const parent = ns.parentNode
    if (!parent) return
    while (ns.firstChild) parent.insertBefore(ns.firstChild, ns)
    parent.removeChild(ns)
  })

  const LAZY_ATTRS = ['data-actualsrc', 'data-original', 'data-src', 'data-original-src']
  const seenTokens = new Set()
  doc.querySelectorAll('img').forEach((img) => {
    const rawW = Number(img.getAttribute('data-rawwidth')) || Number(img.getAttribute('width')) || 0
    const rawH = Number(img.getAttribute('data-rawheight')) || Number(img.getAttribute('height')) || 0
    let src = (img.getAttribute('src') || '').trim()
    const placeholder = !src || src.startsWith('data:')
    if (placeholder) {
      const real = LAZY_ATTRS.map((a) => (img.getAttribute(a) || '').trim()).find((v) => /^https?:\/\//i.test(v))
      if (!real) {
        img.remove() // 纯占位、无真实图 → 不留空块
        return
      }
      src = real
    }
    if (!/^https?:\/\//i.test(src)) {
      img.remove() // 相对地址/其他协议没法加载
      return
    }
    // 同图去重：优先用 URL 里的 v2 token，没有再看 data-original-token
    const token = (
      src.match(/v2-[0-9a-f]{32}/i)?.[0] ||
      img.getAttribute('data-original-token') ||
      ''
    ).toLowerCase()
    if (token) {
      if (seenTokens.has(token)) {
        img.remove()
        return
      }
      seenTokens.add(token)
    }
    // 知乎图片走本地代理（补 Referer），其余直链
    img.src = /\.zhimg\.com/i.test(src) ? api.mediaUrl(src) : src
    // 清理懒加载痕迹
    for (const a of [...LAZY_ATTRS, 'data-original-token', 'data-rawwidth', 'data-rawheight', 'data-size', 'data-thumbnail']) {
      img.removeAttribute(a)
    }
    img.removeAttribute('srcset')
    img.classList.remove('lazy')
    img.loading = 'lazy'
    img.decoding = 'async'
    // 按原始比例占位（图片加载时不跳动），并保持响应式宽度
    if (rawW > 0 && rawH > 0) {
      img.setAttribute('width', String(rawW))
      img.setAttribute('height', String(rawH))
      img.style.aspectRatio = `${rawW} / ${rawH}`
      img.style.maxWidth = '100%'
      img.style.height = 'auto'
    }
  })
  // 占位图删光后可能留下空 figure（只剩 margin），一并去掉
  doc.querySelectorAll('figure').forEach((fig) => {
    if (!fig.querySelector('img, video, iframe, figcaption') && !fig.textContent.trim()) {
      fig.remove()
    }
  })

  // 站内链接：问题/回答/文章/想法转 hash 路由，其余新标签
  doc.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href')
    if (!href) return
    const abs = href.startsWith('http') ? href : ZH + (href.startsWith('/') ? '' : '/') + href
    if (abs.startsWith(ZH + '/question/')) {
      const qid = abs.match(/\/question\/(\d+)/)?.[1]
      const aid = abs.match(/\/answer\/(\d+)/)?.[1]
      if (qid) a.href = '#question/' + qid + (aid ? '?from=' + aid : '')
    } else if (abs.startsWith('https://zhuanlan.zhihu.com/p/')) {
      const id = abs.match(/\/p\/(\d+)/)?.[1]
      if (id) a.href = '#content/article/' + id
    } else if (abs.startsWith(ZH + '/pin/')) {
      const id = abs.match(/\/pin\/(\d+)/)?.[1]
      if (id) a.href = '#content/pin/' + id
    } else {
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
    }
  })

  // 视频卡片（.zvideo）：有视频 id 则替换为可点击播放的容器
  doc.querySelectorAll('.zvideo').forEach((div) => {
    const videoId =
      div.getAttribute('data-video-id') ||
      div.getAttribute('data-id') ||
      (div.innerHTML.match(/\/video\/(\d+)/) || [])[1] ||
      (div.innerHTML.match(/videoId["']?\s*[:=]\s*["']?(\d+)/) || [])[1]
    if (!videoId) return
    const posterImg = div.querySelector('img')
    const poster = posterImg ? api.mediaUrl(posterImg.getAttribute('src') || posterImg.getAttribute('data-src') || '') : ''
    const holder = document.createElement('div')
    holder.className = 'zvideo-holder'
    holder.style.cssText =
      'position:relative;aspect-ratio:16/9;max-width:100%;border-radius:10px;overflow:hidden;background:#000;display:flex;align-items:center;justify-content:center;'
    if (poster) {
      const im = document.createElement('img')
      im.src = poster
      im.alt = ''
      im.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;'
      holder.appendChild(im)
    }
    const play = document.createElement('button')
    play.textContent = '▶'
    play.className = 'zvideo-play'
    play.setAttribute('aria-label', '播放视频')
    play.style.cssText =
      'position:relative;font-size:40px;width:76px;height:76px;border-radius:50%;border:2px solid rgba(255,255,255,.9);color:#fff;background:rgba(0,0,0,.35);cursor:pointer;'
    play.addEventListener('click', (ev) => {
      ev.stopPropagation()
      if (onVideo) onVideo(videoId, holder)
    })
    holder.appendChild(play)
    div.replaceWith(holder)
  })

  // 只把 body 的“子节点”搬进片段，不要把 <body> 元素本身带出去
  const frag = document.createDocumentFragment()
  while (doc.body.firstChild) frag.appendChild(doc.body.firstChild)
  return frag
}

/** 渲染富文本片段到容器 */
export function fillContent(container, html, opts) {
  container.innerHTML = ''
  container.appendChild(renderContent(html || '<p></p>', opts))
}

export const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
