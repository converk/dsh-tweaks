/**
 * 宿主与共享逻辑自测（纯 Node，不需要 DSH 运行时）。
 *
 * 覆盖：
 * - 行差统计（`lib/shared.js`）；
 * - 文件改动工具词表；
 * - 展示路径投影；
 * - 追踪器 + 两条宿主传输的端到端行为：用**真实临时目录**当 `ctx.fs` 后端，
 *   驱动 `apply()` 注册的三个事件监听器，再从私有 RPC 通道与 `/api` 精确 Fetch
 *   路由两个入口调 `state` / `revert` / `reapply`，断言磁盘上的真实内容。
 *
 * 运行：`node scripts/selftest.mjs`
 */
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve as resolvePath, isAbsolute } from 'node:path'
import { apply } from '../lib/index.js'
import { HTTP_ROUTE, RPC_CHANNEL, countLineChanges, displayPathsOf, mutationCallOf, splitLines } from '../lib/shared.js'

let passed = 0
const failures = []

/** 断言。 */
function check(name, condition, detail = '') {
  if (condition) {
    passed += 1
    return
  }
  failures.push(`${name}${detail === '' ? '' : ` — ${detail}`}`)
}

/** 断言相等（浅比较用 JSON）。 */
function equal(name, actual, expected) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  check(name, a === b, `expected ${b}, got ${a}`)
}

/** 真实文件系统后端：把 `ctx.fs` 的最小面接到 node:fs 上。 */
function realFs(writes = []) {
  return {
    resolve: async (path, opts) => {
      const absolute = isAbsolute(path) ? path : resolvePath(opts?.cwd ?? process.cwd(), path)
      return { targetKey: absolute, displayPath: absolute }
    },
    stat: async (target) => {
      try {
        const info = await stat(String(target.targetKey))
        return { type: info.isDirectory() ? 'directory' : 'file', size: info.size }
      } catch {
        return undefined
      }
    },
    readText: async (target) => readFile(String(target.targetKey), 'utf8'),
    writeText: async (target, content, _expected, _signal, policy) => {
      const path = String(target.targetKey)
      writes.push({ path, policy })
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, content, 'utf8')
      return {}
    },
    processPath: (target) => String(target.targetKey),
    contains: (parent, child) => {
      const rel = relative(String(parent.targetKey), String(child.targetKey))
      return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
    },
  }
}

/** 搭一个假宿主上下文：收集监听器、RPC handler、精确 Fetch 路由与沙箱策略请求。 */
function hostHarness() {
  const listeners = new Map()
  const channels = new Map()
  const fetchRoutes = new Map()
  const injectRequests = []
  const writes = []
  const policyRequests = []
  // 部署兜底 root 故意写成别的目录：插件必须按会话 cwd 覆盖它（否则 fs-sandbox 会拒绝写回）。
  const policyState = { mode: 'workspace-write', fallbackRoot: 'C:/fallback-workspace' }
  const sandboxPolicy = {
    workspaceRoot: policyState.fallbackRoot,
    resolve: (request) => {
      policyRequests.push(request)
      return { mode: policyState.mode, workspaceRoot: policyState.fallbackRoot }
    },
  }
  const fs = realFs(writes)
  const connection = {
    rpc: {
      // 与真实契约一致：handle 同步返回 disposer（不是 Promise<disposer>）。
      handle: (channel, handler) => {
        channels.set(channel, handler)
        return async () => {
          channels.delete(channel)
        }
      },
    },
    fetch: {
      register: (route) => {
        fetchRoutes.set(route.path, route)
        return async () => {
          fetchRoutes.delete(route.path)
        }
      },
    },
  }
  const ctx = {
    get: (name) =>
      name === 'fs'
        ? fs
        : name === 'connection'
          ? connection
          : name === 'sandboxPolicy'
            ? sandboxPolicy
            : undefined,
    on: (name, listener) => {
      const list = listeners.get(name) ?? []
      list.push(listener)
      listeners.set(name, list)
      return () => {}
    },
    effect: (run) => {
      void run()
      return () => {}
    },
    inject: (names, callback) => {
      injectRequests.push(names)
      callback(ctx)
      return () => {}
    },
  }
  apply(ctx)
  return { listeners, channels, fetchRoutes, fs, injectRequests, writes, policyRequests, policyState }
}

/** 触发一个事件的全部监听器（waterfall 用 next 串起来）。 */
async function emit(listeners, name, args) {
  const list = listeners.get(name) ?? []
  for (const listener of list) {
    await listener(...args, () => undefined)
  }
}

/** 一次「工具调用」的完整时序：session/event → pre-execute → 执行 → post-execute。 */
async function runTool(harness, sessionId, turn, callId, name, args, body, isError = false) {
  await emit(harness.listeners, 'session/event', [
    { id: sessionId },
    { type: 'tool/call', seq: 1, data: { callId, name, arguments: args, turn } },
  ])
  const exec = { callId, name, arguments: args, agent: { id: sessionId, session: { header: { cwd: harness.cwd } } } }
  await emit(harness.listeners, 'tools/pre-execute', [exec])
  const produced = body === undefined ? undefined : await body()
  await emit(harness.listeners, 'tools/post-execute', [exec, { isError, content: produced }])
}

/** RPC 调用。 */
async function rpc(harness, endpoint, payload) {
  const handler = harness.channels.get(RPC_CHANNEL)
  if (handler === undefined) throw new Error('rpc channel was not registered')
  return handler(endpoint, payload, new AbortController().signal)
}

// ---------------------------------------------------------------------------
// 1. 行差统计
// ---------------------------------------------------------------------------
equal('diff: 相同文本', countLineChanges('a\nb\n', 'a\nb\n'), { added: 0, removed: 0, approximate: false })
equal('diff: 纯新增', countLineChanges('a\nb', 'a\nb\nc\nd'), { added: 2, removed: 0, approximate: false })
equal('diff: 纯删除', countLineChanges('a\nb\nc\nd', 'a\nb'), { added: 0, removed: 2, approximate: false })
equal('diff: 中间替换', countLineChanges('a\nx\nz\nb', 'a\ny\nb'), { added: 1, removed: 2, approximate: false })
equal('diff: 空文件到有内容', countLineChanges('', 'a\nb\n'), { added: 2, removed: 0, approximate: false })
equal('diff: 有内容到空文件', countLineChanges('a\nb\n', ''), { added: 0, removed: 2, approximate: false })
equal('splitLines: 末尾换行不产生空行', splitLines('a\nb\n').length, 2)
equal('splitLines: 空串', splitLines(''), [])
check('diff: 差异超过编辑距离上限时退化为上界估计', countLineChanges(
  Array.from({ length: 2500 }, (_, i) => `a${String(i)}`).join('\n'),
  Array.from({ length: 2500 }, (_, i) => `b${String(i)}`).join('\n'),
).approximate === true)

// ---------------------------------------------------------------------------
// 2. 工具词表
// ---------------------------------------------------------------------------
equal('mutation: write 命中', mutationCallOf('write', { file_path: 'a.ts', content: 'x' }), { tool: 'write', path: 'a.ts' })
equal('mutation: write 缺 content 不命中', mutationCallOf('write', { file_path: 'a.ts' }), null)
equal('mutation: edit 命中', mutationCallOf('edit', { file_path: 'a.ts', old_string: 'x', new_string: 'y' }), {
  tool: 'edit',
  path: 'a.ts',
})
equal('mutation: edit 新旧相同不命中', mutationCallOf('edit', { file_path: 'a.ts', old_string: 'x', new_string: 'x' }), null)
equal('mutation: str_replace_editor create', mutationCallOf('str_replace_editor', {
  command: 'create',
  path: 'a.ts',
  file_text: 'x',
}), { tool: 'str_replace_editor', path: 'a.ts' })
equal('mutation: str_replace_editor view 不命中', mutationCallOf('str_replace_editor', { command: 'view', path: 'a.ts' }), null)
equal('mutation: read 不命中', mutationCallOf('read', { file_path: 'a.ts' }), null)
equal('mutation: 参数是 JSON 字符串也认', mutationCallOf('write', JSON.stringify({ file_path: 'a.ts', content: 'x' })), {
  tool: 'write',
  path: 'a.ts',
})

// ---------------------------------------------------------------------------
// 3. 展示路径
// ---------------------------------------------------------------------------
equal(
  'path: 相对会话工作目录',
  displayPathsOf([{ path: 'D:/w/plugins/a.ts', absolutePath: 'D:/w/plugins/a.ts' }], 'D:/w'),
  ['plugins/a.ts'],
)
equal(
  'path: 有 cwd 时短相对路径优先',
  displayPathsOf(
    [
      { path: 'D:/w/a.ts', absolutePath: 'D:/w/a.ts' },
      { path: 'D:/w/x/b.ts', absolutePath: 'D:/w/x/b.ts' },
    ],
    'D:/w',
  ),
  ['a.ts', 'x/b.ts'],
)
equal(
  'path: cwd 之外的文件退回公共前缀',
  displayPathsOf(
    [
      { path: 'D:/w/a.ts', absolutePath: 'D:/w/a.ts' },
      { path: 'D:/other/b.ts', absolutePath: 'D:/other/b.ts' },
    ],
    'D:/w',
  ),
  ['a.ts', 'other/b.ts'],
)
equal(
  'path: 没有 cwd 时用公共前缀',
  displayPathsOf(
    [
      { path: 'D:/w/x/a.ts', absolutePath: 'D:/w/x/a.ts' },
      { path: 'D:/w/x/y/b.ts', absolutePath: 'D:/w/x/y/b.ts' },
    ],
    null,
  ),
  ['a.ts', 'y/b.ts'],
)
equal(
  'path: 跨盘符退化为末尾两段',
  displayPathsOf(
    [
      { path: 'C:/p/q/a.ts', absolutePath: 'C:/p/q/a.ts' },
      { path: 'D:/x/y/b.ts', absolutePath: 'D:/x/y/b.ts' },
    ],
    null,
  ),
  ['q/a.ts', 'y/b.ts'],
)

// ---------------------------------------------------------------------------
// 4. 追踪器 + RPC 端到端（真实临时目录）
// ---------------------------------------------------------------------------
const root = await mkdtemp(join(tmpdir(), 'dsh-tfr-selftest-'))
const workspace = join(root, 'workspace')
await mkdir(join(workspace, 'src'), { recursive: true })
const harness = hostHarness()
harness.cwd = workspace
const sessionId = 'session-1'

// connection.rpc.handle 内部会拿调用方 ctx 去 webServer.register 挂物理路由，
// 所以注册必须声明 webServer（漏了会抛 `cannot get property "webServer" without inject`，
// 通道静默不存在）——这里把这条约束钉在测试里。
equal('RPC 注册声明了 connection + webServer', harness.injectRequests[0], ['connection', 'webServer'])
equal(
  '两条宿主传输都注册了（RPC 通道 + /api 精确路由）',
  [harness.channels.has(RPC_CHANNEL), harness.fetchRoutes.has(HTTP_ROUTE)],
  [true, true],
)
const fetchRoute = harness.fetchRoutes.get(HTTP_ROUTE)
equal(
  'fetch 路由形状',
  [fetchRoute?.path, fetchRoute?.methods.join(','), fetchRoute?.requestBody],
  [HTTP_ROUTE, 'POST', 'buffered'],
)
check(
  '写了注册诊断日志',
  existsSync(join(tmpdir(), 'dsh-turn-file-revert.log')) &&
    readFileSync(join(tmpdir(), 'dsh-turn-file-revert.log'), 'utf8').includes('register:'),
)

// --- 4.1 新建文件 ---
const newFile = join(workspace, 'src', 'new.ts')
await runTool(harness, sessionId, 1, 'call-new', 'write', { file_path: 'src/new.ts', content: 'const a = 1\nconst b = 2\n' }, async () => {
  await mkdir(dirname(newFile), { recursive: true })
  await writeFile(newFile, 'const a = 1\nconst b = 2\n', 'utf8')
})

let state = await rpc(harness, 'state', { sessionId, turn: 1 })
check('state: 通道已注册且返回 ok', state.ok === true)
equal('state: 新建文件计 2 行新增', [state.value.totalAdded, state.value.totalRemoved], [2, 0])
equal('state: created 标记', state.value.files[0]?.created, true)
equal('state: 按钮动作 = revert', state.value.action, 'revert')
equal('state: 文件数', [state.value.totalFiles, state.value.blocked], [1, 0])

let action = await rpc(harness, 'revert', { sessionId, turn: 1 })
check('revert: ok', action.ok === true)
check('revert: 新建文件被删除', await stat(newFile).then(() => false, () => true))
equal('revert: 动作变为 reapply', action.value.view.action, 'reapply')
equal('revert: 文件 phase', action.value.view.files[0]?.phase, 'reverted')
check('revert: dirty = false（内容与记录一致）', action.value.results[0]?.dirty === false)

action = await rpc(harness, 'reapply', { sessionId, turn: 1 })
check('reapply: ok', action.ok === true)
equal('reapply: 文件内容写回', await readFile(newFile, 'utf8'), 'const a = 1\nconst b = 2\n')
equal('reapply: 动作回到 revert', action.value.view.action, 'revert')

// 幂等：再撤回一次、再重放一次
action = await rpc(harness, 'revert', { sessionId, turn: 1 })
check('revert: 幂等（文件已不在）', action.ok === true)
action = await rpc(harness, 'reapply', { sessionId, turn: 1 })
check('reapply: 幂等（重新写回）', await stat(newFile).then(() => true, () => false))

// `/api` 精确 Fetch 路由与私有 RPC 通道共用同一份 handler（第二条传输的等价性）
const fetchResponse = await fetchRoute.fetch({
  json: async () => ({ endpoint: 'state', payload: { sessionId, turn: 1 } }),
})
const fetchView = await fetchResponse.json()
check(
  'fetch 路由可用且与 RPC 同源',
  fetchView.ok === true && fetchView.value.turn === 1 && fetchView.value.files.length === 1,
)
const badBody = await fetchRoute.fetch({
  json: async () => {
    throw new Error('not json')
  },
})
equal('fetch 路由对非 JSON body 返回 400', badBody.status, 400)

// --- 4.2 修改已有文件 ---
const editedFile = join(workspace, 'src', 'edit.ts')
await writeFile(editedFile, 'line1\nline2\nline3\n', 'utf8')
await runTool(harness, sessionId, 2, 'call-edit', 'edit', { file_path: 'src/edit.ts', old_string: 'line2', new_string: 'line2\nline2b' }, async () => {
  await writeFile(editedFile, 'line1\nline2\nline2b\nline3\n', 'utf8')
})
state = await rpc(harness, 'state', { sessionId, turn: 2 })
equal('state: 修改已有文件 +1 −0', [state.value.totalAdded, state.value.totalRemoved], [1, 0])
equal('state: created = false', state.value.files[0]?.created, false)

action = await rpc(harness, 'revert', { sessionId, turn: 2 })
equal('revert: 已有文件回到改动前', await readFile(editedFile, 'utf8'), 'line1\nline2\nline3\n')
equal('revert: 行数统计保留', [action.value.view.totalAdded, action.value.view.totalRemoved], [1, 0])
action = await rpc(harness, 'reapply', { sessionId, turn: 2 })
equal('reapply: 已有文件回到改动后', await readFile(editedFile, 'utf8'), 'line1\nline2\nline2b\nline3\n')

// 手工改过之后再撤回：dirty 应该报 true，且仍然覆盖
await writeFile(editedFile, 'line1\nmanual\nline3\n', 'utf8')
action = await rpc(harness, 'revert', { sessionId, turn: 2 })
equal('revert: 覆盖手工修改时报 dirty', action.value.results[0]?.dirty, true)
equal('revert: 仍然按改动前内容写回', await readFile(editedFile, 'utf8'), 'line1\nline2\nline3\n')
await rpc(harness, 'reapply', { sessionId, turn: 2 })

// 沙箱策略：写回必须带「按会话解析、workspace root = 会话 cwd」的策略，
// 否则 fs-sandbox 会退回部署兜底 root 并把工作区内的写回判成越界（本机踩过）。
check(
  '写回带了会话级沙箱策略（workspaceRoot = 会话 cwd）',
  harness.writes.length > 0 &&
    harness.writes.every((call) => call.policy?.mode === 'workspace-write' && call.policy?.workspaceRoot === workspace),
)
check(
  '策略按会话解析（resolve 收到 session）',
  harness.policyRequests.some((request) => request?.session !== undefined),
)

// --- 4.3 同回合多次改同一文件：before 取第一次、after 取最后一次 ---
const multi = join(workspace, 'src', 'multi.ts')
await writeFile(multi, 'a\n', 'utf8')
await runTool(harness, sessionId, 3, 'call-m1', 'edit', { file_path: 'src/multi.ts', old_string: 'a', new_string: 'a\nb' }, async () => {
  await writeFile(multi, 'a\nb\n', 'utf8')
})
await runTool(harness, sessionId, 3, 'call-m2', 'edit', { file_path: 'src/multi.ts', old_string: 'b', new_string: 'b\nc' }, async () => {
  await writeFile(multi, 'a\nb\nc\n', 'utf8')
})
state = await rpc(harness, 'state', { sessionId, turn: 3 })
equal('state: 同回合多次改同一文件只有一行', state.value.files.length, 1)
equal('state: 净变化 +2 −0', [state.value.totalAdded, state.value.totalRemoved], [2, 0])
await rpc(harness, 'revert', { sessionId, turn: 3 })
equal('revert: 回到本回合第一次改动前', await readFile(multi, 'utf8'), 'a\n')
await rpc(harness, 'reapply', { sessionId, turn: 3 })
equal('reapply: 回到本回合最后一次改动后', await readFile(multi, 'utf8'), 'a\nb\nc\n')

// --- 4.4 失败调用 / 读类工具不记录 ---
await runTool(harness, sessionId, 4, 'call-fail', 'write', { file_path: 'src/none.ts', content: 'x' }, undefined, true)
await runTool(harness, sessionId, 4, 'call-read', 'read', { file_path: 'src/multi.ts' }, undefined, false)
state = await rpc(harness, 'state', { sessionId, turn: 4 })
equal('state: 失败调用与读类工具不产生记录', state.value.tracked, false)
equal('state: 未追踪回合的 action', state.value.action, 'none')

// --- 4.5 未追踪回合的动作应失败（结构化错误） ---
action = await rpc(harness, 'revert', { sessionId, turn: 99 })
check('revert: 未追踪回合返回 ok:false', action.ok === false)
check('revert: 错误码带插件前缀', String(action.error.code).startsWith('turn-file-revert/'))

// --- 4.6 参数校验与未知 endpoint ---
action = await rpc(harness, 'state', { sessionId: '', turn: 1 })
check('state: 空 sessionId 被拒绝', action.ok === false && action.error.code.endsWith('bad-request'))
action = await rpc(harness, 'state', { sessionId, turn: -1 })
check('state: 负数 turn 被拒绝', action.ok === false)
action = await rpc(harness, 'nope', { sessionId, turn: 1 })
check('未知 endpoint 被拒绝', action.ok === false && action.error.code.endsWith('unknown-endpoint'))

// --- 4.7 工作区之外的新建文件拒绝删除 ---
const outside = join(root, 'outside.txt')
await runTool(
  harness,
  sessionId,
  5,
  'call-out',
  'write',
  { file_path: outside, content: 'x\n' },
  async () => {
    await writeFile(outside, 'x\n', 'utf8')
  },
)
action = await rpc(harness, 'revert', { sessionId, turn: 5 })
equal('revert: 工作区外的新建文件被拒绝', action.value.results[0]?.code, 'outside-workspace')
check('revert: 文件仍在', await stat(outside).then(() => true, () => false))

// --- 4.8 agent/pre-step 兜底归属（没有 tool/call 事件） ---
const fallbackFile = join(workspace, 'src', 'fallback.ts')
// 真实运行时这两个监听器拿到的是同一个 agent 实例（WeakMap 以此为键）。
const fallbackAgent = { id: sessionId, session: { header: { cwd: workspace } } }
await emit(harness.listeners, 'agent/pre-step', [{ agent: fallbackAgent, turn: 6 }])
const fallbackExec = {
  callId: 'call-fallback',
  name: 'str_replace_editor',
  arguments: { command: 'create', path: 'src/fallback.ts', file_text: 'z\n' },
  agent: fallbackAgent,
}
await emit(harness.listeners, 'tools/pre-execute', [fallbackExec])
await writeFile(fallbackFile, 'z\n', 'utf8')
await emit(harness.listeners, 'tools/post-execute', [fallbackExec, { isError: false }])
state = await rpc(harness, 'state', { sessionId, turn: 6 })
equal('pre-step 兜底：回合归属正确', [state.value.tracked, state.value.files[0]?.path], [true, 'src/fallback.ts'])

// ---------------------------------------------------------------------------
// 4.9 注册路径：声明 connection + webServer，等 cordis 回调后再注册
// ---------------------------------------------------------------------------
{
  const deferredChannels = new Map()
  const deferredConnection = {
    rpc: {
      handle: (channel, handler) => {
        deferredChannels.set(channel, handler)
        return async () => {
          deferredChannels.delete(channel)
        }
      },
    },
  }
  let fireInject = null
  let declaredDeps = null
  const deferredCtx = {
    get: (name) => (name === 'fs' ? realFs() : name === 'connection' ? deferredConnection : undefined),
    on: () => () => undefined,
    effect: (run) => {
      void run()
      return () => undefined
    },
    inject: (names, callback) => {
      declaredDeps = names
      // cordis 只在依赖都就绪后才回调；这里先不回调，模拟「还没就绪」。
      fireInject = () => callback(deferredCtx)
      return () => undefined
    },
  }
  apply(deferredCtx)
  equal('注册声明了 connection + webServer', declaredDeps, ['connection', 'webServer'])
  check('依赖未就绪时不注册通道', deferredChannels.size === 0 && typeof fireInject === 'function')
  fireInject?.()
  check('依赖就绪后注册通道', deferredChannels.has(RPC_CHANNEL))
}

// ---------------------------------------------------------------------------
// 4.10 只读沙箱：撤回/重放都不写盘（rm 不经过沙箱，插件自己把关）
// ---------------------------------------------------------------------------
{
  const readOnly = hostHarness()
  readOnly.cwd = workspace
  readOnly.policyState.mode = 'read-only'
  const roFile = join(workspace, 'src', 'readonly.ts')
  await writeFile(roFile, 'a\n', 'utf8')
  await runTool(
    readOnly,
    'session-ro',
    1,
    'call-ro',
    'edit',
    { file_path: 'src/readonly.ts', old_string: 'a', new_string: 'a\nb' },
    async () => {
      await writeFile(roFile, 'a\nb\n', 'utf8')
    },
  )
  const roAction = await rpc(readOnly, 'revert', { sessionId: 'session-ro', turn: 1 })
  equal('只读模式：撤回被拒绝并给出原因码', roAction.value.results[0]?.code, 'sandbox-read-only')
  equal('只读模式：文件内容未被改动', await readFile(roFile, 'utf8'), 'a\nb\n')
  check('只读模式：没有发生任何写盘', readOnly.writes.length === 0)
}

// ---------------------------------------------------------------------------
// 清理
// ---------------------------------------------------------------------------
await rm(root, { recursive: true, force: true })

console.log(`\nturn-file-revert selftest: ${String(passed)} passed, ${String(failures.length)} failed`)
for (const failure of failures) console.log(`  ✗ ${failure}`)
if (failures.length > 0) process.exitCode = 1
