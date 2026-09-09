// zse.js —— 知乎网页 API 的 x-zse-96 请求签名（自研实现）
//
// 背景（大白话）：知乎网页端对 /api/ 请求要求三个头：x-zse-93（版本号）、
// x-zse-96（签名）、x-requested-with: fetch。签名的做法是：
//   1. 把 zse93 + '+' + 请求路径 + '+' + d_c0 cookie（POST 再拼 body）做 MD5；
//   2. 把 MD5 的 32 位十六进制串喂进一个魔改的 AES（zse-v4 算法）加密；
//   3. 输出形如 "2.0_" + 密文，作为 x-zse-96。
//
// zse-v4 不是标准算法，是知乎 JS 里逆向出来的自定义分组密码（轮函数 + 查表
// S 盒 + 自定义 base64 编码）。本文件是按算法语义自行实现的 JS 版（零依赖，
// 只用 node:crypto 的 MD5）；常量表（ZK/ZB/ALPHABET/KEY16）是该算法的公开
// 参数。正确性通过 .scratch/zse-vec（调用 zhihu-plus-plus 的 Rust 参考实现
// 生成的密文向量）对拍验证，见 server/test/zse.test.mjs。
//
// 注意：参考实现（zhihu-plus-plus）与知乎官方 JS 在“是否把 query string 计入
// 签名路径”上存在歧义：Kotlin 侧取的是“含 query 的完整路径”。实现按参考行为
// 默认计入 query（pathOnly=false 时），并与真实 API 联调验证；若知乎只认
// 纯路径（pathOnly=true），切换开关即可，密文由真实请求结果判定。

import { createHash } from 'node:crypto'

// zse-v4 轮密钥（32 个 32 位字）
const ZK = [
  1170614578, 1024848638, 1413669199, 3951632832, 3528873006, 2921909214, 4151847688, 3997739139,
  1933479194, 3323781115, 3888513386, 460404854, 3747539722, 2403641034, 2615871395, 2119585428,
  2265697227, 2035090028, 2773447226, 4289380121, 4217216195, 2200601443, 3051914490, 1579901135,
  1321810770, 456816404, 2903323407, 4065664991, 330002838, 3506006750, 363569021, 2347096187,
]

// zse-v4 S 盒（256 字节）
const ZB = [
  20, 223, 245, 7, 248, 2, 194, 209, 87, 6, 227, 253, 240, 128, 222, 91, 237, 9, 125, 157, 230,
  93, 252, 205, 90, 79, 144, 199, 159, 197, 186, 167, 39, 37, 156, 198, 38, 42, 43, 168, 217,
  153, 15, 103, 80, 189, 71, 191, 97, 84, 247, 95, 36, 69, 14, 35, 12, 171, 28, 114, 178, 148,
  86, 182, 32, 83, 158, 109, 22, 255, 94, 238, 151, 85, 77, 124, 254, 18, 4, 26, 123, 176, 232,
  193, 131, 172, 143, 142, 150, 30, 10, 146, 162, 62, 224, 218, 196, 229, 1, 192, 213, 27, 110,
  56, 231, 180, 138, 107, 242, 187, 54, 120, 19, 44, 117, 228, 215, 203, 53, 239, 251, 127, 81,
  11, 133, 96, 204, 132, 41, 115, 73, 55, 249, 147, 102, 48, 122, 145, 106, 118, 74, 190, 29, 16,
  174, 5, 177, 129, 63, 113, 99, 31, 161, 76, 246, 34, 211, 13, 60, 68, 207, 160, 65, 111, 82,
  165, 67, 169, 225, 57, 112, 244, 155, 51, 236, 200, 233, 58, 61, 47, 100, 137, 185, 64, 17, 70,
  234, 163, 219, 108, 170, 166, 59, 149, 52, 105, 24, 212, 78, 173, 45, 0, 116, 226, 119, 136,
  206, 135, 175, 195, 25, 92, 121, 208, 126, 139, 3, 75, 141, 21, 130, 98, 241, 40, 154, 66, 184,
  49, 181, 46, 243, 88, 101, 183, 8, 23, 72, 188, 104, 179, 210, 134, 250, 201, 164, 89, 216,
  202, 220, 50, 221, 152, 140, 33, 235, 214,
]

// 自定义 base64 字母表
const ALPHABET = '6fpLRqJO8M/c3jnYxFkUVC4ZIG12SiH=5v0mXDazWBTsuw7QetbKdoPyAl+hN9rgE'

// 首块白化密钥（16 字节 ASCII）
const KEY16 = Uint8Array.from(Buffer.from('059053f7d15e01d7', 'ascii'))

// 种子字节（固定 12，对应 zse-v4.js 中 Math.random=()=>0.1 的产物）
const SEED = 12

/** 32 位循环左移 */
function rotl32(x, n) {
  return ((x << n) | (x >>> (32 - n))) >>> 0
}

/** 读出 4 字节大端 u32 */
function readU32BE(b, off) {
  return ((b[off] << 24) | (b[off + 1] << 16) | (b[off + 2] << 8) | b[off + 3]) >>> 0
}

/** 写入 4 字节大端 u32 */
function writeU32BE(v, b, off) {
  b[off] = (v >>> 24) & 0xff
  b[off + 1] = (v >>> 16) & 0xff
  b[off + 2] = (v >>> 8) & 0xff
  b[off + 3] = v & 0xff
}

/** 轮函数 G：S 盒置换 + 线性扩散（四个旋转异或） */
function gTransform(tt) {
  const ti =
    (ZB[(tt >>> 24) & 0xff] * 0x1000000 + ZB[(tt >>> 16) & 0xff] * 0x10000 +
      ZB[(tt >>> 8) & 0xff] * 0x100 + ZB[tt & 0xff]) >>> 0
  return (
    ti ^
    rotl32(ti, 2) ^
    rotl32(ti, 10) ^
    rotl32(ti, 18) ^
    rotl32(ti, 24)
  ) >>> 0
}

/** 对 16 字节分组做 32 轮加密，返回 16 字节密文 */
function rBlock(input16) {
  const tr = new Uint32Array(36)
  tr[0] = readU32BE(input16, 0)
  tr[1] = readU32BE(input16, 4)
  tr[2] = readU32BE(input16, 8)
  tr[3] = readU32BE(input16, 12)
  for (let i = 0; i < 32; i++) {
    const ta = gTransform(tr[i + 1] ^ tr[i + 2] ^ tr[i + 3] ^ ZK[i])
    tr[i + 4] = (tr[i] ^ ta) >>> 0
  }
  const out = new Uint8Array(16)
  writeU32BE(tr[35], out, 0)
  writeU32BE(tr[34], out, 4)
  writeU32BE(tr[33], out, 8)
  writeU32BE(tr[32], out, 12)
  return out
}

/** CBC 式链接加密（以首块密文为 IV） */
function xBlocks(data, iv) {
  const out = []
  for (let off = 0; off < data.length; off += 16) {
    const mixed = new Uint8Array(16)
    for (let i = 0; i < 16; i++) mixed[i] = data[off + i] ^ iv[i]
    iv = rBlock(mixed)
    out.push(...iv)
  }
  return Uint8Array.from(out)
}

/**
 * 自定义 base64：每 3 字节(小端组合成 24 位)吐出 4 个字母表字符，
 * 每个字节与 (58 >> (8*(i%4)))&0xFF 异或（即按 4 字节窗口循环 ^0x3A），
 * 输出时整体按“从尾部向头部”的顺序处理并拼接。
 */
function customEncode(bytes) {
  const data = [...bytes]
  while (data.length % 3 !== 0) data.push(0)
  const out = []
  let i = 0
  for (let p = data.length - 1; p >= 0; p -= 3) {
    const mask = () => (58 >> (8 * (i++ % 4))) & 0xff
    const b0 = data[p] ^ mask()
    const b1 = data[p - 1] ^ mask()
    const b2 = data[p - 2] ^ mask()
    const v = (b0 & 0xff) | ((b1 & 0xff) << 8) | ((b2 & 0xff) << 16)
    out.push(ALPHABET[v & 63], ALPHABET[(v >> 6) & 63], ALPHABET[(v >> 12) & 63], ALPHABET[(v >> 18) & 63])
  }
  return out.join('')
}

/** zse-v4 加密入口：输入任意字符串，输出密文（不含 "2.0_" 前缀） */
export function encryptZseV4(input) {
  const uri = encodeURIComponent(input)
  const plain = [...Buffer.from(uri, 'utf8')]
  const prefix = [SEED, 0]
  const padded = Uint8Array.from([...prefix, ...plain])
  const pad = 16 - (padded.length % 16)
  const full = new Uint8Array(padded.length + pad)
  full.set(padded)
  for (let k = padded.length; k < full.length; k++) full[k] = pad

  const first = new Uint8Array(16)
  for (let i = 0; i < 16; i++) first[i] = full[i] ^ KEY16[i] ^ 42

  const c0 = rBlock(first)
  let cipher = [...c0]
  if (full.length > 16) cipher.push(...xBlocks(full.subarray(16), c0))
  return customEncode(cipher)
}

/** MD5 十六进制小写串 */
function md5Hex(input) {
  return createHash('md5').update(input, 'utf8').digest('hex')
}

/**
 * 从完整 URL 中取签名用路径。
 * 行为对齐参考实现（zhihu-plus-plus 的 Kotlin 侧）：
 *   url.substringAfter("//").substringAfter('/') 前面补 '/'。
 * 该写法会把 query string 一并算入（pathOnly=false 时）。
 */
function pathnameOf(url, pathOnly) {
  const afterScheme = url.slice(url.indexOf('//') + 2)
  const afterHost = afterScheme.slice(afterScheme.indexOf('/') + 1)
  const pathWithQuery = '/' + afterHost
  return pathOnly ? pathWithQuery.split('?')[0] : pathWithQuery
}

/**
 * 生成请求签名三件套。
 * @param {object} opts
 * @param {string} opts.url       完整请求 URL（含 query）
 * @param {string} opts.dc0       d_c0 cookie 值
 * @param {string} [opts.zse93]   默认 '101_3_3.0'
 * @param {string|null} [opts.body] POST 请求体（无则 null）
 * @param {boolean} [opts.pathOnly] 只签路径不含 query（实测开关）
 */
export function zseHeaders({ url, dc0, zse93 = '101_3_3.0', body = null, pathOnly = false }) {
  const path = pathnameOf(url, pathOnly)
  const signSource = [zse93, path, dc0, body].filter((s) => s != null).join('+')
  const zse96 = '2.0_' + encryptZseV4(md5Hex(signSource))
  return { 'x-zse-93': zse93, 'x-zse-96': zse96, 'x-requested-with': 'fetch' }
}

/** 仅测试用：导出内部原语便于对拍 */
export const _internals = { rotl32, gTransform, rBlock, xBlocks, customEncode, md5Hex, pathnameOf }
