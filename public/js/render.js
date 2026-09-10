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

  // 图片：zhimg 系列一律转本地代理
  doc.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src') || img.getAttribute('data-src') || ''
    if (/^https?:\/\/(pic|pic1|pic2|pic3|pic4|pica|p1|p2|p3|p4)\.zhimg\.com/i.test(src)) {
      img.src = api.mediaUrl(src)
      img.loading = 'lazy'
      img.decoding = 'async'
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
