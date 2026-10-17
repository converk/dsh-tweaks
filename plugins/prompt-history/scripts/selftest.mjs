/**
 * prompt-history 自测：只测纯逻辑（历史提取），不依赖 DSH 部署或浏览器。
 *
 * 用 esbuild 把 `src/shared/history.ts` 现场 bundle 成 ESM data URL 再 import，
 * 这样不必为测试单独产出构建文件，也不会把 React / DOM 带进来。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const entry = fileURLToPath(new URL('../src/shared/history.ts', import.meta.url))
const built = await build({
  entryPoints: [entry],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  logLevel: 'silent',
})
const code = built.outputFiles[0]?.text
assert.ok(code !== undefined, 'esbuild produced no output')
const { extractHistory, HISTORY_LIMIT } = await import(
  'data:text/javascript;base64,' + Buffer.from(code, 'utf8').toString('base64')
)

let passed = 0
let failed = 0
function check(name, condition, detail) {
  if (condition) {
    passed += 1
    console.log('  ok   ' + name)
    return
  }
  failed += 1
  console.log('  FAIL ' + name + (detail === undefined ? '' : ' — ' + detail))
}

console.log('== 历史提取：用户消息 / steering / 过滤')
{
  const nodes = [
    { kind: 'assistant', content: [{ type: 'text', text: 'not me' }] },
    { kind: 'user', content: [{ type: 'text', text: 'first' }] },
    { kind: 'steering', content: [{ type: 'text', text: 'interjection' }] },
    { kind: 'tool', content: [{ type: 'text', text: 'tool output' }] },
    { kind: 'user', content: [{ type: 'text', text: 'last' }] },
  ]
  check('只取 user / steering，时间正序', JSON.stringify(extractHistory(nodes)) === JSON.stringify(['first', 'interjection', 'last']))
}

console.log('== 历史提取：多段文本块不粘在一起')
{
  const nodes = [{ kind: 'user', content: [{ type: 'text', text: 'line one' }, { type: 'text', text: 'line two' }] }]
  check('多个 text 块用换行连接', extractHistory(nodes)[0] === 'line one\nline two', JSON.stringify(extractHistory(nodes)))
}

console.log('== 历史提取：空内容 / 非数组 / 相邻去重')
{
  const nodes = [
    { kind: 'user', content: 'not-an-array' },
    { kind: 'user', content: [] },
    { kind: 'user', content: [{ type: 'image', text: 'ignored' }] },
    { kind: 'user', content: [{ type: 'text', text: '  same  ' }] },
    { kind: 'user', content: [{ type: 'text', text: 'same' }] },
    { kind: 'user', content: [{ type: 'text', text: 'same' }] },
    { kind: 'user', content: [{ type: 'text', text: 'different' }] },
    { kind: 'user', content: [{ type: 'text', text: 'same' }] },
  ]
  check(
    '跳过空内容、相邻去重、非相邻保留',
    JSON.stringify(extractHistory(nodes)) === JSON.stringify(['same', 'different', 'same']),
    JSON.stringify(extractHistory(nodes)),
  )
}

console.log('== 历史提取：上限')
{
  const nodes = Array.from({ length: HISTORY_LIMIT + 5 }, (_value, index) => ({
    kind: 'user',
    content: [{ type: 'text', text: 'prompt-' + String(index) }],
  }))
  const history = extractHistory(nodes)
  check('最多保留 HISTORY_LIMIT 条', history.length === HISTORY_LIMIT, String(history.length))
  check('保留的是最近 N 条', history[0] === 'prompt-5' && history.at(-1) === 'prompt-' + String(HISTORY_LIMIT + 4), history[0])
}

// 防止某次重构把常量改小却没人发现（README 与测试共用这个口径）。
check('HISTORY_LIMIT 是 200', HISTORY_LIMIT === 200, String(HISTORY_LIMIT))

// 确保构建入口确实被读过（避免未来误删 shared 模块时测试空转）。
check('shared/history.ts 存在', readFileSync(entry, 'utf8').includes('export function extractHistory'))

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exitCode = 1
