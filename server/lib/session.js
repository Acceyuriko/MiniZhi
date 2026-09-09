// session.js —— 知乎会话（粘贴 cookie）的本地存储
// 存储位置：data/session.json（已 gitignore，不进版本库）。
// cookie 以“原始 Cookie 头字符串”保存（用户在浏览器里整行复制的形态），
// 需要的单个 cookie（如 d_c0）在使用时现场解析。

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data')
const SESSION_FILE = path.join(DATA_DIR, 'session.json')

/** 解析 cookie 头字符串为名值对象（跳过属性项如 Domain/Path/HttpOnly 等） */
export function parseCookies(raw) {
  const out = {}
  for (const pair of raw.split(';')) {
    const idx = pair.indexOf('=')
    if (idx < 0) continue
    const name = pair.slice(0, idx).trim()
    const value = pair.slice(idx + 1).trim()
    if (name) out[name] = value
  }
  return out
}

/** 会话记录：{ cookie: string, signMode: 'full'|'path', savedAt: number } */
let current = null

export function loadSession() {
  if (current !== null) return current
  try {
    const raw = readFileSync(SESSION_FILE, 'utf8')
    current = JSON.parse(raw)
  } catch {
    current = null
  }
  return current
}

export function saveSession(cookie) {
  mkdirSync(DATA_DIR, { recursive: true })
  current = {
    cookie,
    signMode: current?.signMode ?? 'full', // 实测后若知乎只认纯路径，切 'path'
    savedAt: Date.now(),
  }
  writeFileSync(SESSION_FILE, JSON.stringify(current, null, 2), 'utf8')
  return current
}

export function clearSession() {
  current = null
  try {
    writeFileSync(SESSION_FILE, JSON.stringify(null), 'utf8')
  } catch {
    // 文件不存在也视为已清除
  }
}

export function setSignMode(mode) {
  const s = loadSession()
  if (!s) return null
  s.signMode = mode
  writeFileSync(SESSION_FILE, JSON.stringify(s, null, 2), 'utf8')
  return s
}

export function cookieValue(name) {
  const s = loadSession()
  if (!s?.cookie) return null
  return parseCookies(s.cookie)[name] ?? null
}
