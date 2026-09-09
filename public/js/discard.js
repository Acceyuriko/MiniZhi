// discard.js —— 推荐流屏蔽：本地黑名单（localStorage 持久化）+ 知乎云端反馈
// 「不喜欢该内容」= 本地永久忽略该条 + 云端 uninterested_type=less_similar
// 「不看该作者」   = 本地永久屏蔽该作者所有内容 + 云端 uninterested_type=author
// 云端接口（用户抓包实证，无需 x-zst-81，我们的签名可直接过）：
//   POST /api/v4/zrec-feedback/uninterested  表单 body：
//   scene_code=RECOMMEND&content_type={2回答|1文章}&content_token={内容id}
//   &uninterested_type={less_similar|author}&feed_deliver_type=Normal&desktop=true
import { api } from './api.js'

const K_CONTENT = 'mz.discard.content.v1'
const K_AUTHOR = 'mz.discard.author.v1'

const contents = new Set(JSON.parse(localStorage.getItem(K_CONTENT) ?? '[]'))
const authors = new Set(JSON.parse(localStorage.getItem(K_AUTHOR) ?? '[]'))

function persist() {
  localStorage.setItem(K_CONTENT, JSON.stringify([...contents]))
  localStorage.setItem(K_AUTHOR, JSON.stringify([...authors]))
}

const keyOf = (kind, id) => `${kind}:${id}`
const authorKeyOf = (author) => {
  if (!author) return null
  return String(author.id ?? author.urlToken ?? author.name ?? '')
}

export function isContentBlocked(item) {
  return item && contents.has(keyOf(item.machineType ?? item.kind ?? '?', String(item.id ?? '')))
}
export function isAuthorBlocked(item) {
  const k = authorKeyOf(item.author)
  return k ? authors.has(k) : false
}
export function filterList(items) {
  return (items ?? []).filter((it) => !isContentBlocked(it) && !isAuthorBlocked(it))
}

export function blockContent(item) {
  contents.add(keyOf(item.machineType ?? item.kind ?? '?', String(item.id ?? '')))
  persist()
}
export function blockAuthor(item) {
  const k = authorKeyOf(item.author)
  if (k) {
    authors.add(k)
    persist()
  }
  return k
}

/** 云端反馈。contentType: 2=回答 1=文章（其他类型无对应枚举 → 只本地） */
export async function reportUninterested(item, type) {
  const ct = { answer: '2', article: '1' }[item.machineType ?? item.rawType]
  if (!ct || !item.id) return { sent: false }
  const form = new URLSearchParams({
    scene_code: 'RECOMMEND',
    content_type: ct,
    content_token: String(item.id),
    uninterested_type: type,
    feed_deliver_type: 'Normal',
    desktop: 'true',
  }).toString()
  try {
    await api.zh('/api/v4/zrec-feedback/uninterested', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: form,
    })
    return { sent: true }
  } catch (err) {
    return { sent: false, err }
  }
}

export function counts() {
  return { contents: contents.size, authors: authors.size }
}
export function clearAll() {
  contents.clear()
  authors.clear()
  persist()
}
