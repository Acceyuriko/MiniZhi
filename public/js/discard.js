// discard.js —— 「不喜欢该内容 / 不看该作者」：以知乎 API 反馈为准
// 屏蔽状态不存在本地（不落盘、不持久化）：点一次就上报知乎，
//   less_similar = 少推这类内容，author = 少推该作者；
// 本模块只保留*会话内存*记录，用于点完之后立刻隐藏该条/该作者的后续条目，
// 刷新页面即清空，之后完全以知乎服务端返回为准。
// 云端接口（用户抓包实证，无需 x-zst-81，我们的签名可直接过）：
//   POST /api/v4/zrec-feedback/uninterested  表单 body：
//   scene_code=RECOMMEND&content_type={2回答|1文章}&content_token={内容id}
//   &uninterested_type={less_similar|author}&feed_deliver_type=Normal&desktop=true
import { api } from './api.js'

// 清理早期版本写入的本地持久化黑名单（现已不使用）
for (const k of ['mz.discard.content.v1', 'mz.discard.author.v1']) {
  try { localStorage.removeItem(k) } catch { /* 忽略 */ }
}

// 会话内存（不持久化）：本次页面会话内已点过屏蔽的内容/作者
const contents = new Set()
const authors = new Set()

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
}
export function blockAuthor(item) {
  const k = authorKeyOf(item.author)
  if (k) authors.add(k)
  return k
}

/** 云端反馈。contentType: 2=回答 1=文章（其他类型无对应枚举 → 只本地） */
export async function reportUninterested(item, type) {
  // 问题页的回答没有 machineType/rawType 字段，兜底按回答处理
  const kind = item.machineType ?? item.rawType ?? 'answer'
  const ct = { answer: '2', article: '1' }[kind]
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

/** 一次屏蔽：上报知乎（主）+ 记入会话内存（辅，用于立刻隐藏） */
export async function applyDiscard(item, mode) {
  const res = await reportUninterested(item, mode === 'author' ? 'author' : 'less_similar')
  if (mode === 'author') blockAuthor(item)
  else blockContent(item)
  return res
}

/** 屏蔽后的提示文案 */
export function discardToast(res, mode) {
  let extra = ''
  if (res?.err) extra = '（反馈失败，请检查登录）'
  else if (res && !res.sent) extra = '（该类型知乎不支持反馈）'
  return (mode === 'author' ? '已反馈：少推该作者' : '已反馈：少推这类内容') + extra
}

export function counts() {
  return { contents: contents.size, authors: authors.size }
}
export function clearAll() {
  contents.clear()
  authors.clear()
}
