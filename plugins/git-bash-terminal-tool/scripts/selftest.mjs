/**
 * dsh-tweaks-git-bash-terminal-tool 自测：宿主 + 纯逻辑。
 *
 * 直接 import 构建产物 `lib/index.js`（Loader 加载的就是它），因此这份自测同时
 * 验证了「bundle 可加载 + 零 @deepseek-ai 运行时依赖」。
 *
 * 覆盖：
 * 1. Git Bash 发现（WSL 硬排除、由 git 反推、悬空注册表丢弃、排序稳定）；
 * 2. 设置校验（schema 兼容面、validate 语义）；
 * 3. 沙箱升级（逐字文案 + 有序 fail-closed 序列）；
 * 4. per-agent 替换（假 ctx：restrict / register / section 的调用与跳过分支）；
 * 5. 工具契约（parameters / output.schema 形状、render、parseExitStatus、composePath）；
 * 6. 受限执行与沙箱升级的执行期判定（假 sandbox / 假 approval）；
 * 7. 后台任务钩子（假 ctx.jobs）；
 * 8. 真机端到端：用真的 Git Bash 跑命令（没有可用 bash 时自动 skip）。
 *
 * 注意：本文件里的路径一律用**正斜杠**书写 —— Windows 的 path API 接受正斜杠，
 * 且能避免测试源码被反斜杠转义问题干扰。
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  approveEscalation,
  bashOutputSchema,
  composePath,
  createBashTool,
  createSettingsSchema,
  discoverBash,
  escalationHintMarker,
  isBlockedBash,
  parseBashArgs,
  parseExitStatus,
  probeCapability,
  probeDeploymentCapability,
  renderProcessRead,
  renderResult,
  replaceTerminalTool,
  resolveSettings,
  sandboxDenialMarker,
  validateBashPath,
  validateEscalationArgs,
  validateSettings,
  ESCALATION_TARGETS,
  WIDER_MODES,
} from '../lib/index.js'

let passed = 0
let failed = 0

/** 一个断言。 */
function check(name, condition, detail) {
  if (condition) {
    passed += 1
    console.log(`  ok   ${name}`)
    return
  }
  failed += 1
  console.log(`  FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`)
}

/** 断言一个函数抛出包含给定文本的错误。 */
function throws(name, fn, fragment) {
  try {
    fn()
    check(name, false, 'did not throw')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    check(name, fragment === undefined || message.includes(fragment), message)
  }
}

/** 分组标题。 */
function section(title) {
  console.log(`\n== ${title}`)
}

/** 反斜杠形式的路径（与实现内部规范化的比较口径一致）。 */
function win(path) {
  return resolve(path)
}

// ---------------------------------------------------------------------------
// 1. 发现算法
// ---------------------------------------------------------------------------

/** 一个假的探测环境：指定存在的路径、注册表值、PATH 上的 git、PATH 目录。 */
function fakeProbes(options) {
  const existing = new Set((options.existing ?? []).map((p) => win(p).toLowerCase()))
  return {
    fileExists: (path) => existing.has(win(path).toLowerCase()),
    whereGit: () => options.whereGit ?? [],
    // 分隔符归一后再比较：测试源码里的反斜杠转义不影响断言。
    readRegistry: (hive, key, name) => {
      const wanted = [hive, key, name].join("|").replace(/[\\/]+/g, "/")
      const entry = Object.entries(options.registry ?? {}).find(([k]) => k.replace(/[\\/]+/g, "/") === wanted)
      return entry?.[1]
    },
    probeVersion: (path) => options.versions?.[win(path)],
    pathDirs: () => options.pathDirs ?? [],
    env: (name) => options.env?.[name],
  }
}

section('发现算法：WSL 硬排除（决策 A）')
{
  const env = { SystemRoot: 'C:/Windows', LOCALAPPDATA: 'C:/Users/me/AppData/Local' }
  check('System32 下的 bash.exe 被排除', isBlockedBash('C:/Windows/System32/bash.exe', (n) => env[n]))
  check('Sysnative 下的 bash.exe 被排除', isBlockedBash('C:/Windows/Sysnative/bash.exe', (n) => env[n]))
  check(
    'WindowsApps 下的 bash.exe 被排除',
    isBlockedBash('C:/Users/me/AppData/Local/Microsoft/WindowsApps/bash.exe', (n) => env[n]),
  )
  check('大小写不敏感', isBlockedBash('c:/windows/system32/BASH.EXE', (n) => env[n]))
  check('普通 Git Bash 不被排除', !isBlockedBash('D:/env/msys2/usr/bin/bash.exe', (n) => env[n]))
}

section('发现算法：由 git 反推 bash（决策 C）')
{
  const gitExe = 'D:/env/msys2/usr/bin/git.exe'
  const probes = fakeProbes({
    existing: [gitExe, 'D:/env/msys2/usr/bin/bash.exe'],
    whereGit: [gitExe],
    env: { SystemRoot: 'C:/Windows' },
  })
  const candidates = discoverBash({ probes })
  const paths = candidates.map((c) => win(c.path))
  check('反推出 MSYS2 的 bash', paths.includes(win('D:/env/msys2/usr/bin/bash.exe')), paths.join(' | '))
  check('候选带来源 git-path', candidates.every((c) => c.source === 'git-path'))
  check('WSL 的 bash 不出现在候选里', !paths.some((p) => p.toLowerCase().includes('system32')))
  check('存在的那条 valid 为 true', candidates.find((c) => win(c.path) === win('D:/env/msys2/usr/bin/bash.exe'))?.valid === true)
}

section('发现算法：Git for Windows 注册表（含悬空残留）')
{
  const dangling = fakeProbes({
    existing: [],
    registry: { 'HKLM|SOFTWARE\\GitForWindows|InstallPath': 'D:/env/Git' },
    env: {},
  })
  check('悬空注册表不产生候选', discoverBash({ probes: dangling }).length === 0)

  const root = 'C:/Program Files/Git'
  const valid = fakeProbes({
    existing: [root, `${root}/bin/bash.exe`, `${root}/usr/bin/bash.exe`],
    registry: { 'HKLM|SOFTWARE\\GitForWindows|InstallPath': root },
    env: {},
    versions: { [win(`${root}/bin/bash.exe`)]: 'GNU bash, version 5.2.26' },
  })
  const candidates = discoverBash({ probes: valid })
  check('注册表来源出 2 个候选', candidates.length === 2, JSON.stringify(candidates.map((c) => c.path)))
  check('来源标记为 git-for-windows', candidates.every((c) => c.source === 'git-for-windows'))
  check('版本探测写进候选', candidates[0]?.version === 'GNU bash, version 5.2.26')
}

section('发现算法：排序与去重')
{
  const root = 'C:/Program Files/Git'
  const msys = 'C:/msys64'
  const probes = fakeProbes({
    existing: [
      root,
      `${root}/bin/bash.exe`,
      `${root}/usr/bin/bash.exe`,
      `${msys}/usr/bin/bash.exe`,
      'D:/saved/bash.exe',
      'D:/env/msys2/usr/bin/bash.exe',
      'D:/env/msys2/usr/bin/git.exe',
    ],
    whereGit: ['D:/env/msys2/usr/bin/git.exe'],
    registry: { 'HKLM|SOFTWARE\\GitForWindows|InstallPath': root },
    env: {},
  })
  const candidates = discoverBash({ saved: 'D:/saved/bash.exe', probes })
  const order = candidates.map((c) => c.source)
  check('saved 排最前', order[0] === 'saved', order.join(','))
  check('git-for-windows 第二', order[1] === 'git-for-windows', order.join(','))
  check('msys2 早于 git-path', order.indexOf('msys2') < order.indexOf('git-path'), order.join(','))
  const keys = candidates.map((c) => win(c.path).toLowerCase())
  check('路径去重', new Set(keys).size === keys.length, keys.join(' | '))
}

section('发现算法：路径校验')
{
  const probes = fakeProbes({ existing: ['D:/good/bash.exe'], env: { SystemRoot: 'C:/Windows' } })
  check('空路径被拒', validateBashPath('', probes) !== null)
  check('WSL 路径被拒', (validateBashPath('C:/Windows/System32/bash.exe', probes) ?? '').includes('WSL'))
  check('不存在的路径被拒', (validateBashPath('D:/nope/bash.exe', probes) ?? '').includes('找不到'))
  check('存在的路径通过', validateBashPath('D:/good/bash.exe', probes) === null)
}

// ---------------------------------------------------------------------------
// 2. 设置
// ---------------------------------------------------------------------------

section('设置：解析与校验')
{
  check(
    '空对象 → 默认 pwsh / 空路径 / 空候选',
    JSON.stringify(resolveSettings({})) === JSON.stringify({ dialect: 'pwsh', bashPath: '', bashCandidates: [] }),
  )
  check('只给 dialect', resolveSettings({ dialect: 'bash' }).dialect === 'bash')
  check('未知 dialect 回退默认', resolveSettings({ dialect: 'zsh' }).dialect === 'pwsh')
  check('路径去空白', resolveSettings({ dialect: 'bash', bashPath: '  D:/x/bash.exe  ' }).bashPath === 'D:/x/bash.exe')
  check(
    '候选只留字符串、去空白、按 Windows 语义去重',
    JSON.stringify(resolveSettings({ bashCandidates: ['D:/a/bash.exe', 7, '', 'd:/A/bash.exe', 'D:/b/bash.exe'] }).bashCandidates) ===
      JSON.stringify(['D:/a/bash.exe', 'D:/b/bash.exe']),
  )
  check('候选不是数组时退回空列表', resolveSettings({ bashCandidates: 'nope' }).bashCandidates.length === 0)

  const dir = mkdtempSync(join(tmpdir(), 'dsh-git-bash-terminal-tool-'))
  const bashFile = join(dir, 'bash.exe')
  writeFileSync(bashFile, '')
  try {
    check(
      'pwsh 不要求路径',
      (() => {
        validateSettings({ dialect: 'pwsh', bashPath: '', bashCandidates: [] })
        return true
      })(),
    )
    // 空路径是「先选工具、再点自动发现挑路径」的合法中间态：host 放行，会话侧因为
    // 路径为空而跳过替换（仍是 pwsh），所以不会出现「选了 bash 却跑不起来」的半坏状态。
    check(
      'bash 空路径放行',
      (() => {
        validateSettings({ dialect: 'bash', bashPath: '', bashCandidates: [] })
        return true
      })(),
    )
    throws(
      'bash 指向不存在的文件被拒',
      () => validateSettings({ dialect: 'bash', bashPath: join(dir, 'nope.exe'), bashCandidates: [] }),
      '找不到文件',
    )
    check(
      'bash 指向存在的文件通过',
      (() => {
        validateSettings({ dialect: 'bash', bashPath: bashFile, bashCandidates: [] })
        return true
      })(),
    )
    throws(
      'bash 指向 WSL 被拒',
      () => validateSettings({ dialect: 'bash', bashPath: 'C:/Windows/System32/bash.exe', bashCandidates: [] }),
      'WSL',
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

section('设置：wire schema 的根节点（浏览器侧解码的命门）')
{
  const wire = createSettingsSchema().toJSON()
  check('uid 指向一个已声明的 ref', typeof wire.uid === 'number' && wire.refs?.[wire.uid] !== undefined)
  check(
    '根节点是 object（绝不能是 dialect 的 union）',
    wire.refs[wire.uid].type === 'object',
    JSON.stringify(wire.refs[wire.uid]).slice(0, 120),
  )
  check(
    '根节点声明了三个字段',
    JSON.stringify(Object.keys(wire.refs[wire.uid].dict ?? {}).sort()) ===
      JSON.stringify(['bashCandidates', 'bashPath', 'dialect']),
  )
  check(
    '每个字段都指向已声明的 ref',
    Object.values(wire.refs[wire.uid].dict ?? {}).every((id) => wire.refs[id] !== undefined),
  )
}

section('能力探测')
{
  check(
    '非 win32 不支持',
    probeDeploymentCapability({ platform: 'linux', hasTools: true, hasSystemPrompt: true, hasSettings: true })
      .supported === false,
  )
  check(
    'win32 齐全则支持',
    probeDeploymentCapability({ platform: 'win32', hasTools: true, hasSystemPrompt: true, hasSettings: true })
      .supported === true,
  )
  const missingTools = probeDeploymentCapability({
    platform: 'win32',
    hasTools: false,
    hasSystemPrompt: true,
    hasSettings: true,
  })
  check('缺 tools 不支持且有原因', missingTools.supported === false && typeof missingTools.reason === 'string')
}

// ---------------------------------------------------------------------------
// 3. 沙箱升级（逐字对齐官方契约）
// ---------------------------------------------------------------------------

section('沙箱升级：常量与标记逐字对齐')
{
  check(
    'ESCALATION_TARGETS',
    JSON.stringify(ESCALATION_TARGETS) === JSON.stringify(['workspace-write', 'danger-full-access']),
  )
  check(
    'WIDER_MODES',
    JSON.stringify(WIDER_MODES) ===
      JSON.stringify({
        'read-only': ['workspace-write', 'danger-full-access'],
        'workspace-write': ['danger-full-access'],
      }),
  )
  check('拒绝标记', sandboxDenialMarker('workspace-write') === '[sandbox: file access denied under workspace-write mode]')
  check(
    '升级提示标记',
    escalationHintMarker('command') ===
      '[sandbox: escalation available — retry this exact command once with sandbox_permissions (the narrowest wider mode that suffices) + justification; the approval prompt asks the user]',
  )
}

section('沙箱升级：参数配对校验')
{
  throws(
    'sandbox_permissions 缺 justification',
    () => validateEscalationArgs('danger-full-access', undefined),
    'invalid escalation: sandbox_permissions requires a justification',
  )
  throws(
    'justification 单独出现',
    () => validateEscalationArgs(undefined, 'because'),
    'invalid escalation: justification is only valid together with sandbox_permissions',
  )
  throws(
    '空 justification',
    () => validateEscalationArgs('workspace-write', '   '),
    'invalid justification: expected a non-empty sentence',
  )
  check(
    '成对且非空通过',
    (() => {
      validateEscalationArgs('workspace-write', 'need to write outside the workspace')
      return true
    })(),
  )
}

/** 一次升级请求的基准（read-only 上调到 workspace-write）。 */
const BASE_REQUEST = {
  requestedMode: 'workspace-write',
  justification: 'need to write outside the workspace',
  effectiveMode: 'read-only',
  subject: 'command',
}

/** 断言一次 `approveEscalation` 的抛错文案与官方逐字一致。 */
async function expectEscalationError(name, approval, expected, request = BASE_REQUEST) {
  try {
    await approveEscalation(request, approval)
    check(name, false, 'did not throw')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    check(name, message === expected, message)
  }
}

section('沙箱升级：有序 fail-closed 序列')
{
  const allowed = await approveEscalation(BASE_REQUEST, {
    approver: { request: async () => 'allowed-once' },
    agent: {},
    callId: 'call-1',
    toolName: 'bash',
  })
  check('allowed-once 返回目标模式', allowed === 'workspace-write')

  await expectEscalationError(
    '非严格更宽（danger-full-access 之上没有可升的）',
    { approver: { request: async () => 'allowed-once' }, agent: {}, callId: 'c', toolName: 'bash' },
    'sandbox escalation to "workspace-write" is not strictly wider than this call\'s current "danger-full-access" mode',
    { ...BASE_REQUEST, effectiveMode: 'danger-full-access' },
  )
  await expectEscalationError(
    '无审批服务',
    { approver: undefined, agent: {}, callId: 'c', toolName: 'bash' },
    'sandbox escalation to "workspace-write" requires approval, but no approval service is composed',
  )
  await expectEscalationError(
    '无 agent',
    { approver: { request: async () => 'allowed-once' }, agent: undefined, callId: 'c', toolName: 'bash' },
    'sandbox escalation to "workspace-write" requires approval, but the call has no agent to route it through',
  )
  await expectEscalationError(
    'rejected 文案',
    { approver: { request: async () => 'rejected' }, agent: {}, callId: 'c', toolName: 'bash' },
    'the user rejected escalating this command to "workspace-write"',
  )
  await expectEscalationError(
    'cancelled 文案',
    { approver: { request: async () => 'cancelled' }, agent: {}, callId: 'c', toolName: 'bash' },
    'approval for escalating to "workspace-write" was cancelled',
  )
  await expectEscalationError(
    'unavailable 文案',
    { approver: { request: async () => 'unavailable' }, agent: {}, callId: 'c', toolName: 'bash' },
    'sandbox escalation to "workspace-write" requires approval, but no approval channel is available',
  )

  let asked
  await approveEscalation(BASE_REQUEST, {
    approver: {
      request: async (req) => {
        asked = req
        return 'allowed-once'
      },
    },
    agent: { id: 'a' },
    callId: 'call-9',
    toolName: 'bash',
  })
  check(
    '审批 reason 文案',
    asked.reason === 'escalate sandbox to workspace-write: need to write outside the workspace',
    asked.reason,
  )
  check('审批 toolName 是 bash', asked.toolName === 'bash')
  check('审批 callId 透传', asked.callId === 'call-9')
}

// ---------------------------------------------------------------------------
// 4. per-agent 替换（假 ctx）
// ---------------------------------------------------------------------------

/** 造一个假的 agent.ctx：记录 restrict / register / section 的调用。 */
function fakeAgent(options = {}) {
  const calls = { restrict: [], register: [], section: [], effects: [] }
  const tools = {
    restrict(filter) {
      calls.restrict.push(filter)
      if (options.restrictThrows === true) throw new Error('tools.restrict() names unknown global tool "pwsh"')
      return () => {}
    },
    register(definition) {
      calls.register.push(definition)
      return () => {}
    },
  }
  const systemPrompt = {
    section(section) {
      calls.section.push(section)
      return () => {}
    },
    getSectionOrder() {
      return 1000
    },
  }
  const id = options.id ?? 'session-1'
  const ctx = {
    get(name) {
      if (name === 'tools') return tools
      if (name === 'systemPrompt') return systemPrompt
      return options.services?.[name]
    },
    on() {},
    effect(fn, label) {
      calls.effects.push(label)
      return fn()
    },
    inject(names, callback) {
      callback(ctx)
    },
  }
  return { agent: { id, ctx, session: { id, header: { cwd: 'D:/work' } } }, calls }
}

/** 一个只有可选服务读取能力的宿主 ctx（替换逻辑只用 `get`）。 */
const HOST = { get: () => undefined, on() {}, effect() {} }

const GIT_BASH = 'D:/env/msys2/usr/bin/bash.exe'

/** 宿主侧的假 ctx（替换逻辑只用 `get` 读全局服务）。 */
function fakeHost(services = {}) {
  return {
    get: (name) => services[name],
    on() {},
    effect() {},
  }
}

section('替换：能力探测')
{
  const { agent } = fakeAgent()
  const capability = probeCapability(agent.ctx)
  check('探测到 tools', capability.toolsLike && capability.registerLike && capability.restrictLike)
  check('探测到 systemPrompt', capability.promptLike)
}

section('替换：成功路径的四个动作')
{
  const services = { subprocess: { spawn() {} } }
  const { agent, calls } = fakeAgent({ services })
  const attempt = replaceTerminalTool(fakeHost(services), agent, { dialect: 'bash', bashPath: GIT_BASH })
  check('applied', attempt.applied === true, attempt.reason)
  check(
    'restrict 只 deny pwsh',
    JSON.stringify(calls.restrict) === JSON.stringify([{ deny: ['pwsh'] }]),
    JSON.stringify(calls.restrict),
  )
  check('注册了名为 bash 的工具', calls.register.length === 1 && calls.register[0].name === 'bash')
  const names = calls.section.map((s) => `${s.name}:${String(s.order)}`).sort()
  check(
    '注册了 tool:bash / tool:pwsh 两个 section',
    JSON.stringify(names) === JSON.stringify(['tool:bash:1000', 'tool:pwsh:1010']),
    names.join(','),
  )
  check(
    'tool:pwsh 的文本为空（压掉 PowerShell 提示词）',
    (calls.section.find((s) => s.name === 'tool:pwsh') ?? {}).text === '',
  )
  check('所有 disposer 都登记到了 agent.ctx.effect', calls.effects.length === 4, String(calls.effects.length))
  check('注册的工具带 output.schema', typeof calls.register[0].output.render === 'function')
}

section('替换：跳过分支')
{
  const pwsh = replaceTerminalTool(fakeHost(), fakeAgent({ services: {} }).agent, { dialect: 'pwsh', bashPath: '' })
  check('设置是 pwsh 时跳过', pwsh.applied === false && pwsh.reason.includes('pwsh'), pwsh.reason)
  const noPath = replaceTerminalTool(fakeHost(), fakeAgent({ services: {} }).agent, { dialect: 'bash', bashPath: '' })
  check('bashPath 为空时跳过', noPath.applied === false && noPath.reason.includes('bashPath'), noPath.reason)

  const services = { subprocess: { spawn() {} } }
  const hidden = fakeAgent({ restrictThrows: true, services })
  const subAgent = replaceTerminalTool(fakeHost(services), hidden.agent, { dialect: 'bash', bashPath: GIT_BASH })
  check(
    'restrict 抛错（子代理继承）时跳过且不注册工具',
    subAgent.applied === false && hidden.calls.register.length === 0,
    subAgent.reason,
  )
  check('restrict 抛错时也不注册 section', hidden.calls.section.length === 0, String(hidden.calls.section.length))

  const missing = replaceTerminalTool(fakeHost(), fakeAgent({ services: {} }).agent, {
    dialect: 'bash',
    bashPath: GIT_BASH,
  })
  check('缺 ctx.subprocess 时跳过', missing.applied === false && missing.reason.includes('subprocess'), missing.reason)
}

// ---------------------------------------------------------------------------
// 5. 工具契约
// ---------------------------------------------------------------------------

/**
 * 官方 JSON Schema 子集的**忠实移植**（`dsh-tools/lib/index.js` 的 `checkSchemaNode` /
 * `checkObjectSchemaTail`，0.1.5-rc.1 实测）。
 *
 * 为什么要移植：`tools.register` 会对 `output.schema` 跑 `assertSupportedJsonSchema`，
 * 而官方源码里 `defineTool` 的 `required: true` 是 **DSL 语法**，编译时会提升成父对象的
 * `required: [...]` 数组 —— 把 DSL 写法当成 JSON Schema 直接手写，注册时会全量报错
 * （真机上栽过一次，见 `src/host/bash-tool.ts` 的注释）。这里把规则搬进自测，
 * 保证以后改 schema 时立刻失败，而不是等到运行时被 DSH 拒。
 * 另外：环境里能拿到真的 `@deepseek-ai/dsh-tools` 时，会用真的校验器再验一遍。
 * @param schema - 待校验的原始 JSON Schema。
 * @returns 违规列表（空 = 合规）。
 */
function assertSubsetViolations(schema) {
  const TYPES = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']
  const SCALARS = ['string', 'number', 'integer', 'boolean', 'null']
  const ANNOTATIONS = ['description', 'title', 'default', 'examples']
  const CONSTRAINTS = ['type', 'oneOf', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const']
  const ONE_OF_SIBLINGS = ['properties', 'required', 'additionalProperties']
  const ALLOWED = new Set([...CONSTRAINTS, ...ANNOTATIONS])
  const violations = []
  const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)

  const walk = (node, path) => {
    if (!isRecord(node)) {
      violations.push(path + ' must be a schema object')
      return
    }
    for (const key of Object.keys(node)) {
      if (!ALLOWED.has(key)) violations.push(path + '.' + key + ' is not a supported keyword')
    }
    const hasType = Object.hasOwn(node, 'type')
    const hasOneOf = Object.hasOwn(node, 'oneOf')
    if (hasType && hasOneOf) {
      violations.push(path + ' cannot declare both type and oneOf')
      return
    }
    if (!hasType && !hasOneOf) {
      for (const key of ONE_OF_SIBLINGS) {
        if (Object.hasOwn(node, key)) violations.push(path + '.' + key + ' requires type or oneOf')
      }
      return
    }
    if (hasOneOf) {
      for (const key of ONE_OF_SIBLINGS) {
        if (Object.hasOwn(node, key)) violations.push(path + '.' + key + ' is not supported beside oneOf')
      }
      if (!Array.isArray(node.oneOf) || node.oneOf.length < 2) {
        violations.push(path + '.oneOf must be an array of at least two schemas')
      } else {
        node.oneOf.forEach((branch, index) => walk(branch, path + '.oneOf[' + index + ']'))
      }
      return
    }
    const type = node.type
    if (typeof type !== 'string' || !TYPES.includes(type)) {
      violations.push(path + '.type must be one of ' + TYPES.join('/'))
      return
    }
    for (const [key, types] of Object.entries({
      properties: ['object'],
      required: ['object'],
      additionalProperties: ['object'],
      items: ['array'],
      enum: SCALARS,
      const: SCALARS,
    })) {
      if (Object.hasOwn(node, key) && !types.includes(type)) {
        violations.push(path + '.' + key + ' is not supported on type "' + type + '"')
      }
    }
    if (type === 'object') {
      const properties = Object.hasOwn(node, 'properties') ? node.properties : undefined
      if (Object.hasOwn(node, 'properties')) {
        if (!isRecord(properties)) violations.push(path + '.properties must be an object of schemas')
        else for (const [key, child] of Object.entries(properties)) walk(child, path + '.properties.' + key)
      }
      if (Object.hasOwn(node, 'required')) {
        const required = node.required
        if (!Array.isArray(required) || required.some((entry) => typeof entry !== 'string')) {
          violations.push(path + '.required must be an array of strings')
        } else {
          const declared = isRecord(properties) ? properties : {}
          for (const key of required) {
            if (!Object.hasOwn(declared, key)) violations.push(path + '.required names "' + key + '" which is not in properties')
          }
        }
      }
      if (Object.hasOwn(node, 'additionalProperties') && typeof node.additionalProperties !== 'boolean') {
        violations.push(path + '.additionalProperties must be a boolean')
      }
      return
    }
    if (type === 'array') {
      if (Object.hasOwn(node, 'items')) walk(node.items, path + '.items')
      return
    }
    const scalarOk = (value) =>
      type === 'null'
        ? value === null
        : type === 'integer'
          ? typeof value === 'number' && Number.isInteger(value)
          : typeof value === type
    if (Object.hasOwn(node, 'enum') && (!Array.isArray(node.enum) || node.enum.length === 0 || !node.enum.every(scalarOk))) {
      violations.push(path + '.enum must be a non-empty array of ' + type + ' values')
    }
    if (Object.hasOwn(node, 'const') && !scalarOk(node.const)) violations.push(path + '.const must be ' + type)
  }

  walk(schema, 'schema')
  return violations
}

/** 极简值校验（对齐官方 `validateJsonSchemaValue` 的关键语义：required / additionalProperties / oneOf 恰好一支）。 */
function validateValue(schema, value, path = 'value') {
  const violations = []
  const walk = (node, candidate, at) => {
    if (Object.hasOwn(node, 'oneOf')) {
      const matched = node.oneOf.filter((branch) => {
        const before = violations.length
        walk(branch, candidate, at)
        const ok = violations.length === before
        violations.length = before
        return ok
      })
      if (matched.length !== 1) violations.push(at + ' must match exactly one oneOf branch (matched ' + matched.length + ')')
      return
    }
    const type = node.type
    const scalarOk =
      type === 'null'
        ? candidate === null
        : type === 'integer'
          ? typeof candidate === 'number' && Number.isInteger(candidate)
          : type === 'number'
            ? typeof candidate === 'number'
            : type === 'string'
              ? typeof candidate === 'string'
              : type === 'boolean'
                ? typeof candidate === 'boolean'
                : false
    if (type === 'object') {
      if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
        violations.push(at + ' must be an object')
        return
      }
      for (const key of Array.isArray(node.required) ? node.required : []) {
        if (!Object.hasOwn(candidate, key)) violations.push(at + '.' + key + ' is required')}
      if (node.additionalProperties === false) {
        for (const key of Object.keys(candidate)) {
          if (!Object.hasOwn(node.properties ?? {}, key)) violations.push(at + '.' + key + ' is not allowed')
        }
      }
      for (const [key, child] of Object.entries(node.properties ?? {})) {
        if (Object.hasOwn(candidate, key)) walk(child, candidate[key], at + '.' + key)
      }
      return
    }
    if (type === 'array') {
      if (!Array.isArray(candidate)) {
        violations.push(at + ' must be an array')
        return
      }
      if (node.items !== undefined) candidate.forEach((entry, index) => walk(node.items, entry, at + '[' + index + ']'))
      return
    }
    if (!scalarOk) violations.push(at + ' must be ' + type)
    if (Object.hasOwn(node, 'const') && candidate !== node.const) violations.push(at + ' must equal ' + JSON.stringify(node.const))
    if (Object.hasOwn(node, 'enum') && !node.enum.includes(candidate)) violations.push(at + ' must be one of ' + JSON.stringify(node.enum))
  }
  walk(schema, value, path)
  return violations
}

/** 结构深比较（返回第一个差异，或 null）。 */
function diffShape(actual, expected, path = 'schema') {
  if (expected === null || typeof expected !== 'object') {
    return actual === expected ? null : path + ': ' + JSON.stringify(actual) + ' != ' + JSON.stringify(expected)
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return path + ': array length differs'
    for (let i = 0; i < expected.length; i += 1) {
      const diff = diffShape(actual[i], expected[i], path + '[' + i + ']')
      if (diff !== null) return diff
    }
    return null
  }
  if (typeof actual !== 'object' || actual === null || Array.isArray(actual)) return path + ': expected object'
  for (const key of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
    if (!Object.hasOwn(actual, key)) return path + '.' + key + ': missing'
    if (!Object.hasOwn(expected, key)) return path + '.' + key + ': unexpected'
    const diff = diffShape(actual[key], expected[key], path + '.' + key)
    if (diff !== null) return diff
  }
  return null
}

/**
 * 官方 `defineTool` **编译后**的 `output.schema` 快照（本机部署实测，非手写猜测）。
 * 断言它同形，等于断言 UI 的 terminal 卡片/退出码 pill 契约不变。
 */
const OFFICIAL_OUTPUT_SNAPSHOT = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: { kind: { type: 'string', const: 'background' }, jobId: { type: 'string' } },
      required: ['kind', 'jobId'],
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', const: 'foreground' },
        exitCode: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        signal: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        timedOut: { type: 'boolean' },
        aborted: { type: 'boolean' },
        timeoutMs: { type: 'number' },
        stdout: {
          type: 'object',
          additionalProperties: false,
          properties: { text: { type: 'string' }, truncated: { type: 'boolean' }, spillPath: { type: 'string' } },
          required: ['text', 'truncated'],
        },
        stderr: {
          type: 'object',
          additionalProperties: false,
          properties: { text: { type: 'string' }, truncated: { type: 'boolean' }, spillPath: { type: 'string' } },
          required: ['text', 'truncated'],
        },
        sandbox: {
          type: 'object',
          additionalProperties: false,
          properties: {
            mode: { type: 'string' },
            denied: { type: 'boolean' },
            enforcement: { type: 'string' },
            runnerFailed: { type: 'boolean' },
          },
          required: ['mode', 'denied'],
        },
      },
      required: ['kind', 'exitCode', 'signal', 'timedOut', 'aborted', 'timeoutMs', 'stdout', 'stderr'],
    },
  ],
}

/** 环境里能拿到真的 `@deepseek-ai/dsh-tools` 时返回它的校验器（否则 undefined → 只跑移植版）。 */
async function resolveRealSchemaValidator() {
  const { existsSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { pathToFileURL } = await import('node:url')
  const candidates = []
  if (process.env.DSH_TOOLS_ENTRY) candidates.push(process.env.DSH_TOOLS_ENTRY)
  if (process.env.DSH_STABLE_HOME) {
    candidates.push(join(process.env.DSH_STABLE_HOME, 'node_modules/@deepseek-ai/dsh-tools/lib/index.js'))
  }
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    try {
      const mod = await import(pathToFileURL(candidate).href)
      if (typeof mod.assertSupportedJsonSchema === 'function' && typeof mod.validateJsonSchemaValue === 'function') {
        return {
          entry: candidate,
          assertSupportedJsonSchema: mod.assertSupportedJsonSchema,
          validateJsonSchemaValue: mod.validateJsonSchemaValue,
        }
      }
    } catch {
      // 换下一个候选。
    }
  }
  return undefined
}

const realValidator = await resolveRealSchemaValidator()
console.log(
  realValidator === undefined
    ? '  info 未提供 DSH_TOOLS_ENTRY / DSH_STABLE_HOME：只跑移植版 schema 校验'
    : '  info 用真实校验器复核：' + realValidator.entry,
)

section('设置：用真 schemastery 复核 wire schema（有部署时）')
{
  const home = process.env.DSH_STABLE_HOME
  if (home === undefined) {
    console.log('  info 未提供 DSH_STABLE_HOME：跳过真 schemastery 复核（浏览器侧就是用它解码的）')
  } else {
    const { pathToFileURL } = await import('node:url')
    const entry = join(home, 'node_modules/@deepseek-ai/schemastery/lib/index.mjs')
    try {
      const mod = await import(pathToFileURL(entry).href)
      const Schema = mod.Schema ?? mod.default ?? mod
      const wire = createSettingsSchema().toJSON()
      // 浏览器侧 SettingsSchemaService 就是这么重建 schema 再校验 section 的。
      const schema = new Schema(JSON.parse(JSON.stringify(wire)))
      check('重建后的根是 object', schema.type === 'object', String(schema.type))
      const value = schema({ dialect: 'bash', bashPath: 'D:/x/bash.exe', bashCandidates: ['D:/x/bash.exe'] })
      check('host 存的值能通过浏览器侧校验', value.dialect === 'bash' && value.bashCandidates.length === 1)
      check(
        '缺字段时默认值正确',
        JSON.stringify(schema({})) === JSON.stringify({ dialect: 'pwsh', bashPath: '', bashCandidates: [] }),
      )
    } catch (error) {
      check('真 schemastery 复核', false, error instanceof Error ? error.message : String(error))
    }
  }
}

section('工具：parameters / output.schema 形状（对齐官方编译结果）')
{
  const runtime = { bashPath: 'D:/bash.exe', subprocess: { spawn() {} } }
  const tool = createBashTool(runtime)
  check('工具名是 bash', tool.name === 'bash')
  check('描述提到 Git Bash', tool.description.includes('Git Bash'))
  check('未 advertise 时无 sandbox_permissions', !('sandbox_permissions' in tool.parameters.properties))

  // 1) parameters：必须与官方 `defineTool` 编译结果同形（`required` 是根上的数组）。
  check(
    'parameters.required 是根上的数组',
    JSON.stringify(tool.parameters.required) === JSON.stringify(['command', 'description']),
    JSON.stringify(tool.parameters.required),
  )
  check(
    'parameters 叶子不带 required（DSL 里的 required:true 是编译期语法）',
    !JSON.stringify(tool.parameters.properties).includes('"required"'),
  )
  check('parameters 不声明 additionalProperties（与官方编译结果一致）', !('additionalProperties' in tool.parameters))
  const paramDiff = diffShape(
    {
      type: tool.parameters.type,
      properties: {
        command: { type: 'string' },
        description: { type: 'string' },
        timeoutMs: { type: 'number' },
        workdir: { type: 'string' },
        run_in_background: { type: 'boolean' },
      },
      required: tool.parameters.required,
    },
    {
      type: 'object',
      properties: {
        command: { type: 'string' },
        description: { type: 'string' },
        timeoutMs: { type: 'number' },
        workdir: { type: 'string' },
        run_in_background: { type: 'boolean' },
      },
      required: ['command', 'description'],
    },
    'parameters',
  )
  check('parameters 的键集/类型/required 与官方编译结果一致', paramDiff === null, paramDiff ?? '')

  // 2) output.schema：与官方编译结果逐键同形。
  const outputDiff = diffShape(bashOutputSchema(), OFFICIAL_OUTPUT_SNAPSHOT, 'output')
  check('output.schema 与官方编译结果同形', outputDiff === null, outputDiff ?? '')

  // 3) 官方子集校验器（移植版 + 可用时的真实版）—— 本轮 regression 的直接防线。
  const paramViolations = assertSubsetViolations(tool.parameters)
  check('parameters 通过官方子集校验（移植版）', paramViolations.length === 0, paramViolations.join(' | '))
  const outputViolations = assertSubsetViolations(bashOutputSchema())
  check('output.schema 通过官方子集校验（移植版）', outputViolations.length === 0, outputViolations.join(' | '))
  if (realValidator !== undefined) {
    let message = null
    try {
      realValidator.assertSupportedJsonSchema(tool.parameters)
      realValidator.assertSupportedJsonSchema(bashOutputSchema())
    } catch (error) {
      message = String(error.message)
    }
    check('真实 assertSupportedJsonSchema 通过', message === null, message ?? '')
  }

  // 4) advertise 升级字段后的形状。
  const escalated = createBashTool({ ...runtime, shellSandboxMode: 'workspace-write' })
  check('advertise 后出现 sandbox_permissions', 'sandbox_permissions' in escalated.parameters.properties)
  check(
    'enum 等于 ESCALATION_TARGETS',
    JSON.stringify(escalated.parameters.properties.sandbox_permissions.enum) ===
      JSON.stringify(['workspace-write', 'danger-full-access']),
  )
  const escalatedViolations = assertSubsetViolations(escalated.parameters)
  check('advertise 后仍通过官方子集校验', escalatedViolations.length === 0, escalatedViolations.join(' | '))
  if (realValidator !== undefined) {
    let message = null
    try {
      realValidator.assertSupportedJsonSchema(escalated.parameters)
    } catch (error) {
      message = String(error.message)
    }
    check('advertise 后真实校验器也通过', message === null, message ?? '')
  }

  // 5) 真实返回的值必须落在声明的 output.schema 里。
  const foregroundValue = {
    kind: 'foreground',
    exitCode: 0,
    signal: null,
    timedOut: false,
    aborted: false,
    timeoutMs: 1000,
    stdout: { text: 'ok', truncated: false },
    stderr: { text: '', truncated: false },
  }
  const values = [
    ['foreground', foregroundValue],
    [
      'foreground+denied',
      { ...foregroundValue, exitCode: 1, sandbox: { mode: 'read-only', denied: true, enforcement: 'partial' } },
    ],
    ['background', { kind: 'background', jobId: 'bash-1' }],
  ]
  for (const [name, value] of values) {
    const violations = validateValue(bashOutputSchema(), value)
    check(name + ' 值符合 output.schema（移植版）', violations.length === 0, violations.join(' | '))
    if (realValidator !== undefined) {
      const realViolations = realValidator.validateJsonSchemaValue(bashOutputSchema(), value)
      check(name + ' 值通过真实值校验', realViolations.length === 0, realViolations.join(' | '))
    }
  }
}

section('工具：参数校验文案')
{
  throws(
    '空 command',
    () => parseBashArgs({ command: '  ', description: 'x' }, true, false),
    'invalid command: expected a non-empty string',
  )
  throws(
    '空 description',
    () => parseBashArgs({ command: 'ls', description: '' }, true, false),
    'invalid description: expected a non-empty string',
  )
  throws(
    '非正数 timeoutMs',
    () => parseBashArgs({ command: 'ls', description: 'x', timeoutMs: 0 }, true, false),
    'invalid timeoutMs: expected a positive number, got 0',
  )
  throws(
    '未 advertise 却给 sandbox_permissions',
    () =>
      parseBashArgs(
        { command: 'ls', description: 'x', sandbox_permissions: 'workspace-write', justification: 'y' },
        true,
        false,
      ),
    'sandbox_permissions is not available in this composition',
  )
  check('合法参数通过', parseBashArgs({ command: 'ls', description: 'List' }, true, false).command === 'ls')
}

section('工具：渲染与解析')
{
  const value = {
    kind: 'foreground',
    exitCode: 1,
    signal: null,
    timedOut: false,
    aborted: false,
    timeoutMs: 1000,
    stdout: { text: 'hello', truncated: false },
    stderr: { text: 'boom', truncated: false },
  }
  const text = renderResult(value)
  check('stdout + [stderr] 分段', text.startsWith('hello\n[stderr]\nboom'), JSON.stringify(text))
  check('非零退出追加标记', text.endsWith('[exit code: 1]'), JSON.stringify(text))

  const empty = renderResult({
    ...value,
    exitCode: 0,
    stdout: { text: '', truncated: false },
    stderr: { text: '', truncated: false },
  })
  check('空输出 → (no output)', empty === '(no output)', JSON.stringify(empty))

  const denied = renderResult(
    {
      ...value,
      stdout: { text: '', truncated: false },
      stderr: { text: '', truncated: false },
      sandbox: { mode: 'read-only', denied: true },
    },
    ESCALATION_TARGETS,
  )
  check(
    '拒绝标记 + 升级提示',
    denied.includes(sandboxDenialMarker('read-only')) && denied.includes(escalationHintMarker('command')),
    denied,
  )

  const truncated = renderResult({ ...value, stdout: { text: 'tail', truncated: true, spillPath: 'C:/spill.txt' } })
  check('截断提示带 spill 路径', truncated.includes('[output truncated; full output: C:/spill.txt]'), truncated)

  check(
    'parseExitStatus 拆出 exitCode',
    JSON.stringify(parseExitStatus('out\n[exit code: 3]')) === JSON.stringify({ body: 'out', exitCode: 3 }),
  )
  check(
    'parseExitStatus 拆出 signal',
    JSON.stringify(parseExitStatus('out\n[killed by signal: SIGKILL]')) ===
      JSON.stringify({ body: 'out', signal: 'SIGKILL' }),
  )
  check('parseExitStatus 默认 0', JSON.stringify(parseExitStatus('out')) === JSON.stringify({ body: 'out', exitCode: 0 }))

  check(
    'renderProcessRead 的 lossy 提示',
    renderProcessRead({ delta: 'x', lossy: true, stdoutSpillPath: 'a', stderrSpillPath: 'b' }).includes(
      '[some output was dropped from memory; full output: a, b]',
    ),
  )
  const composed = composePath('D:/env/msys2/usr/bin/bash.exe', 'C:/Windows')
  check(
    'composePath 前置 Git 目录',
    win(composed.split(';')[0]) === win('D:/env/msys2/usr/bin') && composed.endsWith('C:/Windows'),
    composed,
  )
}

// ---------------------------------------------------------------------------
// 6. 工具的受限 / 升级执行路径（假 sandbox + 假 approval）
// ---------------------------------------------------------------------------

/** 受限执行用的工具运行期（`confine` 用假的，只是把 argv 原样包一层）。 */
function confinedRuntime(extra) {
  return {
    bashPath: 'D:/env/msys2/usr/bin/bash.exe',
    shellSandboxMode: 'read-only',
    sandboxPolicy: { resolve: () => ({ mode: 'read-only', workspaceRoot: 'D:/work' }) },
    sandbox: {
      confine: (argv, policy) => ({
        argv: ['D:/fake-runner.exe', '--mode', policy.mode, '--', ...argv],
        enforcement: 'partial',
        denialSignatures: ['access is denied'],
        runnerFailureRules: [],
      }),
    },
    subprocess: {
      spawn: () => {
        throw new Error('spawn should not be reached')
      },
    },
    ...extra,
  }
}

/** 断言一次受限执行抛出的文案。 */
async function expectExecuteError(name, runtime, args, expected) {
  const tool = createBashTool(runtime)
  try {
    await tool.execute(args, {
      callId: 'call-x',
      signal: new AbortController().signal,
      agent: { id: 'a', session: { id: 'a', header: { cwd: 'D:/work' } }, ctx: {} },
    })
    check(name, false, 'did not throw')
  } catch (error) {
    check(name, String(error.message) === expected, String(error.message))
  }
}

section('工具：受限执行 + 升级（执行期判定）')
{
  const escalated = { command: 'echo x', description: 'x', sandbox_permissions: 'workspace-write', justification: 'need it' }
  await expectExecuteError(
    '无审批服务',
    confinedRuntime({ approval: undefined }),
    escalated,
    'sandbox escalation to "workspace-write" requires approval, but no approval service is composed',
  )
  await expectExecuteError(
    '被用户拒绝',
    confinedRuntime({ approval: { request: async () => 'rejected' } }),
    escalated,
    'the user rejected escalating this command to "workspace-write"',
  )
  await expectExecuteError(
    '目标模式不严格更宽（read-only 请求 read-only）',
    confinedRuntime({ approval: { request: async () => 'allowed-once' } }),
    { command: 'echo x', description: 'x', sandbox_permissions: 'read-only', justification: 'downgrade' },
    'sandbox escalation to "read-only" is not strictly wider than this call\'s current "read-only" mode',
  )
  await expectExecuteError(
    'sandbox_permissions 缺 justification（schema 之外的兜底）',
    confinedRuntime({ approval: { request: async () => 'allowed-once' } }),
    { command: 'echo x', description: 'x', sandbox_permissions: 'workspace-write' },
    'invalid escalation: sandbox_permissions requires a justification',
  )

  // 获准之后：argv 经过 confine 包装，且结果里的 sandbox.mode 换成获准的模式。
  const seen = []
  const runtime = confinedRuntime({
    approval: { request: async () => 'allowed-once' },
    subprocess: {
      spawn(spec) {
        seen.push(spec.argv)
        return {
          collected: {
            stdout: { readFrom: () => ({ text: 'ok', nextOffset: 0, lossy: false }) },
            stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
          },
          done: Promise.resolve({ exitCode: 0, signal: null }),
          terminate: () => undefined,
        }
      },
    },
  })
  const tool = createBashTool(runtime)
  const value = await tool.execute(escalated, {
    callId: 'call-ok',
    signal: new AbortController().signal,
    agent: { id: 'a', session: { id: 'a', header: { cwd: 'D:/work' } }, ctx: {} },
  })
  check(
    '获准后 argv 被 confine 包住',
    seen.length === 1 && seen[0][0] === 'D:/fake-runner.exe' && seen[0].includes('D:/env/msys2/usr/bin/bash.exe'),
    JSON.stringify(seen[0] ?? []),
  )
  check('结果里的沙箱模式是获准的模式', value.sandbox?.mode === 'workspace-write', JSON.stringify(value.sandbox))
  check('未受限模式不广告升级字段', !('sandbox_permissions' in createBashTool({ bashPath: 'D:/b/bash.exe', subprocess: { spawn: () => undefined } }).parameters.properties))
}

// ---------------------------------------------------------------------------
// 7. 后台任务路径（假 ctx.jobs）
// ---------------------------------------------------------------------------

section('工具：后台任务钩子')
{
  const batches = []
  const tool = createBashTool({
    bashPath: 'D:/env/msys2/usr/bin/bash.exe',
    subprocess: {
      spawn() {
        return {
          collected: {
            stdout: { readFrom: () => ({ text: 'bg-hello\n', nextOffset: 10, lossy: false }) },
            stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
          },
          done: Promise.resolve({ exitCode: 0, signal: null }),
          terminate: () => undefined,
        }
      },
    },
    jobs: {
      start(spec) {
        batches.push({ kind: spec.kind, label: spec.label, hooks: spec.run() })
        return 'bash-1'
      },
    },
  })
  const value = await tool.execute(
    { command: 'echo bg-hello', description: 'background', run_in_background: true },
    { callId: 'call-bg', signal: new AbortController().signal },
  )
  check('返回 background 值', value.kind === 'background' && value.jobId === 'bash-1', JSON.stringify(value))
  check('job kind 是 bash（官方注册过的 kind）', batches[0]?.kind === 'bash', batches[0]?.kind)
  check('job label 是命令本身', batches[0]?.label === 'echo bg-hello', batches[0]?.label)
  check('后台钩子给了 readOutput', typeof batches[0]?.hooks.readOutput === 'function')
  const outcome = await batches[0].hooks.done
  check('终态映射为 completed + exit code', outcome.status === 'completed' && outcome.detail === 'exit code: 0', JSON.stringify(outcome))
  check('readOutput 给出增量文本', batches[0].hooks.readOutput() === 'bg-hello\n', JSON.stringify(batches[0].hooks.readOutput()))

  const noJobs = createBashTool({ bashPath: 'D:/b/bash.exe', subprocess: { spawn: () => undefined } })
  try {
    await noJobs.execute({ command: 'x', description: 'x', run_in_background: true }, {
      callId: 'call-bg2',
      signal: new AbortController().signal,
    })
    check('缺 ctx.jobs 时报错', false, 'did not throw')
  } catch (error) {
    check(
      '缺 ctx.jobs 时报错',
      String(error.message).includes('background jobs unavailable'),
      String(error.message),
    )
  }
}

// ---------------------------------------------------------------------------
// 8. 真机端到端（真的 Git Bash）
// ---------------------------------------------------------------------------

/**
 * 用 `node:child_process` 实现最小可用的 subprocess collect 协议
 * （与 `ctx.subprocess` 的采集语义同形：管道 + 累积文本 + terminate）。
 */
function localSubprocess() {
  return {
    spawn(spec) {
      const child = spawn(spec.argv[0], spec.argv.slice(1), { cwd: spec.cwd, env: spec.env, windowsHide: true })
      const stdoutChunks = []
      const stderrChunks = []
      child.stdout.on('data', (chunk) => stdoutChunks.push(chunk))
      child.stderr.on('data', (chunk) => stderrChunks.push(chunk))
      const done = new Promise((resolveDone, rejectDone) => {
        child.on('error', rejectDone)
        child.on('close', (code, signal) => resolveDone({ exitCode: code, signal: signal ?? null }))
      })
      const reader = (chunks) => ({
        readFrom() {
          return { text: Buffer.concat(chunks).toString('utf8'), nextOffset: 0, lossy: false }
        },
      })
      return {
        collected: { stdout: reader(stdoutChunks), stderr: reader(stderrChunks) },
        done,
        terminate() {
          child.kill()
        },
      }
    },
  }
}

section('真机：用真的 Git Bash 跑命令')
{
  const usable = discoverBash({}).find((candidate) => candidate.valid)
  if (usable === undefined) {
    console.log('  skip 没有找到可用的 Git Bash（候选为空）')
  } else {
    console.log(
      `  info 使用 ${usable.path}（${usable.source}）${usable.version === undefined ? '' : ` — ${usable.version}`}`,
    )
    const tool = createBashTool({ bashPath: usable.path, subprocess: localSubprocess() })
    const okResult = await tool.execute(
      { command: 'echo hello-from-git-bash; git --version', description: 'probe git bash' },
      { callId: 'call-1', signal: new AbortController().signal },
    )
    check('exitCode 为 0', okResult.exitCode === 0, JSON.stringify(okResult))
    check('stdout 里有 echo 结果', okResult.stdout.text.includes('hello-from-git-bash'), okResult.stdout.text)
    check('git 在 Git Bash 里可用', /git version \d/.test(okResult.stdout.text), okResult.stdout.text)
    check('渲染无退出码标记（0 退出）', !renderResult(okResult).includes('[exit code:'), renderResult(okResult))

    const failing = await tool.execute({ command: 'exit 7', description: 'fail on purpose' }, {
      callId: 'call-2',
      signal: new AbortController().signal,
    })
    check('非零退出被报告', renderResult(failing).endsWith('[exit code: 7]'), renderResult(failing))

    const timeout = await tool.execute({ command: 'sleep 5', description: 'timeout on purpose', timeoutMs: 300 }, {
      callId: 'call-3',
      signal: new AbortController().signal,
    })
    check(
      '超时被标记',
      timeout.timedOut === true && renderResult(timeout).includes('[timed out after 300ms]'),
      renderResult(timeout),
    )

    const cancelled = new AbortController()
    cancelled.abort()
    try {
      await tool.execute({ command: 'echo never', description: 'cancel first' }, {
        callId: 'call-4',
        signal: cancelled.signal,
      })
      check('预先取消 → abort 错误', false, 'did not throw')
    } catch (error) {
      check(
        '预先取消 → abort 错误',
        error.name === 'AbortError' && error.code === 'ABORTED',
        `${error.name}/${error.code}`,
      )
    }
  }
}

section('真机：命令确实由 bash 解释（POSIX 语义，不是 pwsh）')
{
  const usable = discoverBash({}).find((candidate) => candidate.valid)
  if (usable === undefined) {
    console.log('  skip 没有找到可用的 Git Bash')
  } else {
    const tool = createBashTool({ bashPath: usable.path, subprocess: localSubprocess() })
    const result = await tool.execute(
      {
        command: 'if [ -n "$BASH_VERSION" ]; then echo bash-ok; fi; echo $((2+3)); printf "%s\n" "$0"',
        description: 'posix check',
      },
      { callId: 'call-5', signal: new AbortController().signal },
    )
    check('BASH_VERSION 存在（确实是 bash 而不是 pwsh）', result.stdout.text.includes('bash-ok'), result.stdout.text)
    check('POSIX 算术展开可用', result.stdout.text.includes('5'), result.stdout.text)
    check('$0 指向 bash', result.stdout.text.includes('bash'), result.stdout.text)
  }
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exitCode = 1
