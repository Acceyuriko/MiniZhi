// video.js —— 知乎视频播放（play_info → mp4 直连 / m3u8 hls.js）
import { api } from './api.js'

let hlsLib = null
async function loadHls() {
  if (hlsLib) return hlsLib
  await new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = '/vendor/hls.min.js'
    s.onload = resolve
    s.onerror = () => reject(new Error('hls.js 加载失败'))
    document.head.appendChild(s)
  })
  hlsLib = window.Hls
  return hlsLib
}

/**
 * 在 holder（已替换的 .zvideo 容器）内播放视频。
 * contentId = 所在回答/文章 id，用于 play_info 的 content_id。
 */
export async function playVideoIn(videoId, contentId, holder, { onError } = {}) {
  const fail = (msg) => {
    if (onError) onError(msg)
  }
  try {
    const res = await api.zh(`https://www.zhihu.com/api/v4/video/play_info?r=${videoId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-app-za': 'OS=webplayer' },
      body: JSON.stringify({
        content_id: String(contentId),
        content_type_str: 'answer',
        video_id: videoId,
        scene_code: 'answer_detail_web',
        is_only_video: true,
      }),
    })
    const mp4s = res?.video_play?.playlist?.mp4 ?? []
    let best = null
    for (const v of mp4s) if (!best || (v.bitrate ?? 0) > (best.bitrate ?? 0)) best = v
    const mp4Url = best?.url?.[0]
    holder.innerHTML = ''
    const video = document.createElement('video')
    video.controls = true
    video.autoplay = true
    video.style.cssText = 'width:100%;aspect-ratio:16/9;background:#000;display:block;'
    if (mp4Url && /\.mp4(\?|$)/i.test(mp4Url)) {
      video.src = api.mediaUrl(mp4Url)
      holder.appendChild(video)
      video.play().catch(() => {})
      return
    }
    // m3u8 → hls.js（经本地代理）
    if (mp4Url) {
      const Hls = await loadHls()
      if (Hls.isSupported()) {
        const hls = new Hls()
        hls.loadSource(api.mediaUrl(mp4Url))
        hls.attachMedia(video)
        holder.appendChild(video)
        return
      }
      // 老浏览器：给外链
      return fail(`m3u8 需要支持 HLS 的浏览器，可<a href="${mp4Url}" target="_blank" rel="noopener">在知乎打开</a>`)
    }
    fail('未拿到视频地址')
  } catch (err) {
    fail('视频拉取失败：' + (err?.message ?? err))
  }
}
