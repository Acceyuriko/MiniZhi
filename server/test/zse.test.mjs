// zse.test.mjs —— 自研签名的对拍与结构测试
// 向量文件 .scratch/zse-vectors.txt 由 Rust 参考实现（zhihu-plus-plus/rs-zse-sign）
// 生成：每行 "输入 => 密文"。文件不存在时跳过对拍（向量只在本地生成，不入库）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { encryptZseV4, zseHeaders, _internals } from '../lib/zse.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const vectorsFile = path.join(root, '.scratch', 'zse-vectors.txt')

test('encryptZseV4 与 Rust 参考实现对拍', { skip: !existsSync(vectorsFile) }, () => {
  const lines = readFileSync(vectorsFile, 'utf8').split(/\r?\n/).filter(Boolean)
  assert.ok(lines.length >= 4, '向量文件应有内容')
  let checked = 0
  for (const line of lines) {
    const sep = line.indexOf(' => ')
    if (sep < 0) continue
    const input = line.slice(0, sep)
    const expected = line.slice(sep + 4)
    assert.equal(encryptZseV4(input), expected, `向量不一致：输入 ${JSON.stringify(input)}`)
    checked++
  }
  assert.ok(checked >= 4, '应至少校验 4 条向量')
})

test('md5 与公开测试向量一致（RFC 1321 样例）', () => {
  assert.equal(_internals.md5Hex(''), 'd41d8cd98f00b204e9800998ecf8427e')
  assert.equal(_internals.md5Hex('abc'), '900150983cd24fb0d6963f7d28e17f72')
})

test('签名头结构正确', () => {
  const h = zseHeaders({ url: 'https://www.zhihu.com/api/v4/me', dc0: 'AgEEabc==|zhihu' })
  assert.equal(h['x-zse-93'], '101_3_3.0')
  assert.match(h['x-zse-96'], /^2\.0_[A-Za-z0-9+/=]+$/)
  assert.equal(h['x-requested-with'], 'fetch')
})

test('pathnameOf：含 query 与纯路径两种口径', () => {
  const url = 'https://www.zhihu.com/api/v4/questions/123/feeds?limit=20&order=updated'
  assert.equal(_internals.pathnameOf(url, false), '/api/v4/questions/123/feeds?limit=20&order=updated')
  assert.equal(_internals.pathnameOf(url, true), '/api/v4/questions/123/feeds')
})

test('zse96 对同 URL 与 d_c0 是确定性的，且对 URL 敏感', () => {
  const a = zseHeaders({ url: 'https://www.zhihu.com/api/v4/me', dc0: 'X' })['x-zse-96']
  const b = zseHeaders({ url: 'https://www.zhihu.com/api/v4/me', dc0: 'X' })['x-zse-96']
  const c = zseHeaders({ url: 'https://www.zhihu.com/api/v4/me?x=1', dc0: 'X' })['x-zse-96']
  assert.equal(a, b)
  assert.notEqual(a, c)
})
