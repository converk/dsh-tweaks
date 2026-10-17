/**
 * dsh-tweaks-model-capabilities 纯逻辑自测。
 *
 * 只测 `lib/capability.js`（由 `node build.mjs` 产出），不碰 DOM / React / DSH：
 *   node build.mjs && node scripts/selftest.mjs
 *
 * 覆盖：7 档；一个档都不勾 = 不支持思考（false）；只勾 off 被拒；非 off 档空拼写
 * 被拒；未勾选档不写键；只写 reasoningEfforts、不碰官方多模态；manageReasoning=false
 * （DeepSeek 没有每模型字段）不产生字段与 op；models[] 数组模式保留其它条目与
 * name/compat；没有 models[] 时用官方编辑器可见 id 完整物化并删 modelOverrides；
 * 未保存模型被拒；协议预置只填档位表、绝不写 compat。
 *
 * DSH 契约防漂移段：插件源码里的裸字符串 +（有部署时）官方产物原文。
 * 任一官方片段消失 = 契约已漂移，自测必须报红。
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const modulePath = new URL('../lib/capability.js', import.meta.url)
if (!existsSync(modulePath)) {
  console.error('missing ' + fileURLToPath(modulePath) + '; run "node build.mjs" first')
  process.exit(2)
}
const cap = await import(modulePath.href)

// 官方产物里的模板串 / 占位符用字符码拼（本文件保持无模板字面量，方便纯文本核对）。
const TICK = String.fromCharCode(96)
const DOLLAR = String.fromCharCode(36)

let passed = 0
const failures = []

/** 跑一个用例；失败不中断，最后统一退出码。 */
function test(name, run) {
  try {
    run()
    passed += 1
    console.log('ok - ' + name)
  } catch (error) {
    failures.push({ name, error })
    console.error('not ok - ' + name)
    console.error(error)
  }
}

/** 标准 profile 路径。 */
const PATH = ['providers', 'route']

// ---------------------------------------------------------------------------
// 档位 / 草稿（多模态已交还官方控件，这里只测 reasoningEfforts）
// ---------------------------------------------------------------------------

test('THINKING_LEVELS: 两家协议词表的并集（按升级顺序）', () => {
  assert.deepEqual(Array.from(cap.THINKING_LEVELS), ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
})

test('draftFromEntry: 完整条目还原成草稿（不再有多模态字段）', () => {
  const draft = cap.draftFromEntry({
    id: 'glm-5.3',
    reasoningEfforts: { off: null, minimal: 'minimal', high: 'high', max: 'max', xhigh: 'xhigh' },
    input: ['text', 'image'],
  })
  assert.deepEqual(draft.reasoning, { off: '', minimal: 'minimal', high: 'high', max: 'max', xhigh: 'xhigh' })
  assert.deepEqual(Object.keys(draft), ['reasoning'])
})

test('draftFromEntry: false / 官方多模态字段 / 非对象都不产生草稿字段', () => {
  assert.deepEqual(cap.draftFromEntry({ reasoningEfforts: false }), { reasoning: {} })
  assert.deepEqual(cap.draftFromEntry({ input: ['text', 'image'] }), { reasoning: {} })
  assert.deepEqual(cap.draftFromEntry({ inputModalities: ['text', 'image'] }), { reasoning: {} })
  assert.deepEqual(cap.draftFromEntry(undefined), cap.emptyDraft())
})

test('fieldValuesFromDraft: 一个档都不勾 = 不支持思考（false），不再写 input', () => {
  const { values, issues } = cap.fieldValuesFromDraft('m', cap.emptyDraft())
  assert.deepEqual(issues, [])
  assert.equal(values.reasoningEfforts, false)
  assert.equal(Object.prototype.hasOwnProperty.call(values, 'input'), false)
  assert.deepEqual(Object.keys(values), ['reasoningEfforts'])
})

test('fieldValuesFromDraft: off 留空写 null，非 off 原样写拼写', () => {
  const { values, issues } = cap.fieldValuesFromDraft('m', {
    reasoning: { off: '', low: 'low', high: 'high', max: 'ultra' },
  })
  assert.deepEqual(issues, [])
  assert.deepEqual(values.reasoningEfforts, { off: null, low: 'low', high: 'high', max: 'ultra' })
  assert.deepEqual(Object.keys(values), ['reasoningEfforts'])
})

test('fieldValuesFromDraft: 未勾选档不写键（= 本体钉成不支持）', () => {
  const { values } = cap.fieldValuesFromDraft('m', { reasoning: { off: '', high: 'high' } })
  assert.equal(Object.prototype.hasOwnProperty.call(values.reasoningEfforts, 'medium'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(values.reasoningEfforts, 'low'), false)
  assert.deepEqual(Object.keys(values.reasoningEfforts), ['off', 'high'])
})

test('fieldValuesFromDraft: 只勾 off 被拒', () => {
  const { issues } = cap.fieldValuesFromDraft('m', { reasoning: { off: '' } })
  assert.deepEqual(issues.map((issue) => issue.code), ['reasoning-only-off'])
})

test('fieldValuesFromDraft: 非 off 档空拼写被拒', () => {
  const { issues } = cap.fieldValuesFromDraft('m', { reasoning: { off: '', high: '   ' } })
  assert.deepEqual(issues.map((issue) => issue.code), ['reasoning-wire-required'])
  assert.equal(issues[0].level, 'high')
})

test('validateDraft: 模型 ID 不能为空', () => {
  assert.deepEqual(cap.validateDraft('   ', cap.emptyDraft()).map((issue) => issue.code), ['model-id-empty'])
})

test('draftsEqual / copyDraft', () => {
  const a = cap.emptyDraft()
  assert.equal(cap.draftsEqual(a, cap.emptyDraft()), true)
  assert.equal(cap.draftsEqual(a, { reasoning: { high: 'high' } }), false)
  const custom = { reasoning: { off: '', high: 'high' } }
  const copy = cap.copyDraft(custom)
  assert.deepEqual(copy, custom)
  assert.notEqual(copy.reasoning, custom.reasoning)
})

// ---------------------------------------------------------------------------
// buildModelOps：只写 reasoningEfforts，绝不碰官方多模态字段
// ---------------------------------------------------------------------------

test('buildModelOps: 只改 reasoning 时保留 name/compat/input/容量（官方多模态不被覆盖）', () => {
  const userSection = {
    providers: {
      route: {
        models: [
          {
            id: 'glm-5.3',
            name: 'GLM 5.3',
            compat: { thinkingFormat: 'openai' },
            contextWindow: 1000000,
            maxTokens: 131072,
            input: ['text', 'image'],
          },
          { id: 'qwen3.8-flash', name: 'Qwen 3.8 Flash', description: 'keep me' },
        ],
      },
    },
  }
  const plan = cap.buildModelOps({
    userSection,
    settingsPath: PATH,
    edits: [{ id: 'glm-5.3', draft: { reasoning: { off: '', high: 'high', max: 'ultra' } } }],
  })
  assert.deepEqual(plan.issues, [])
  assert.equal(plan.mode, 'models')
  assert.equal(plan.ops.length, 1)
  assert.deepEqual(plan.ops[0].path, ['providers', 'route', 'models'])
  const models = plan.ops[0].value
  assert.equal(models.length, 2)
  assert.equal(models[0].id, 'glm-5.3')
  assert.equal(models[0].name, 'GLM 5.3')
  assert.deepEqual(models[0].compat, { thinkingFormat: 'openai' })
  assert.deepEqual(models[0].input, ['text', 'image'])
  assert.deepEqual(models[0].reasoningEfforts, { off: null, high: 'high', max: 'ultra' })
  assert.equal(models[0].contextWindow, 1000000)
  assert.equal(models[0].maxTokens, 131072)
  assert.equal(models[1].description, 'keep me')
})

test('buildModelOps: 没有 input 的条目也不会被补成 text（继承能力不被剥离）', () => {
  const userSection = { providers: { route: { models: [{ id: 'a', name: 'A' }] } } }
  const plan = cap.buildModelOps({
    userSection,
    settingsPath: PATH,
    edits: [{ id: 'a', draft: { reasoning: { high: 'high' } } }],
  })
  assert.deepEqual(plan.issues, [])
  assert.equal(Object.prototype.hasOwnProperty.call(plan.ops[0].value[0], 'input'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(plan.ops[0].value[0], 'inputModalities'), false)
})

test('buildModelOps: 用户层没有 models[] -> 用可见 id 物化并删 modelOverrides（不带 input）', () => {
  const userSection = {
    providers: {
      route: {
        modelOverrides: { b: { name: 'B override', reasoningEfforts: { high: 'high' } } },
      },
    },
  }
  const plan = cap.buildModelOps({
    userSection,
    settingsPath: PATH,
    visibleModelIds: ['a', 'b', 'c'],
    edits: [{ id: 'a', draft: cap.emptyDraft() }],
  })
  assert.deepEqual(plan.issues, [])
  assert.deepEqual(plan.ops, [
    {
      op: 'set',
      path: ['providers', 'route', 'models'],
      value: [
        { id: 'a', reasoningEfforts: false },
        { id: 'b', name: 'B override', reasoningEfforts: { high: 'high' } },
        { id: 'c' },
      ],
    },
    { op: 'unset', path: ['providers', 'route', 'modelOverrides'] },
  ])
})

test('buildModelOps: 没有 models[] 也没有可见 id -> models-not-configured', () => {
  const plan = cap.buildModelOps({
    userSection: {},
    settingsPath: PATH,
    edits: [{ id: 'a', draft: cap.emptyDraft() }],
  })
  assert.deepEqual(plan.ops, [])
  assert.deepEqual(plan.issues.map((issue) => issue.code), ['models-not-configured'])
})

test('buildModelOps: 模型还没保存 -> model-not-saved', () => {
  const plan = cap.buildModelOps({
    userSection: { providers: { route: { models: [{ id: 'a' }] } } },
    settingsPath: PATH,
    edits: [{ id: 'b', draft: cap.emptyDraft() }],
  })
  assert.deepEqual(plan.ops, [])
  assert.deepEqual(plan.issues.map((issue) => issue.code), ['model-not-saved'])
  assert.equal(plan.issues[0].id, 'b')
})

test('buildModelOps: models 与 modelOverrides 并存 -> storage-conflict', () => {
  const plan = cap.buildModelOps({
    userSection: { providers: { route: { models: [{ id: 'a' }], modelOverrides: { a: { input: ['text'] } } } } },
    settingsPath: PATH,
    edits: [],
  })
  assert.deepEqual(plan.ops, [])
  assert.deepEqual(plan.issues.map((issue) => issue.code), ['storage-conflict'])
})

test('buildModelOps: 改动与已存值相同 -> 不产生 op', () => {
  const userSection = {
    providers: { route: { models: [{ id: 'a', reasoningEfforts: { high: 'high' }, input: ['text'] }] } },
  }
  const plan = cap.buildModelOps({
    userSection,
    settingsPath: PATH,
    edits: [{ id: 'a', draft: { reasoning: { high: 'high' } } }],
  })
  assert.deepEqual(plan.issues, [])
  assert.deepEqual(plan.ops, [])
})

test('buildModelOps: 清空档位 = 写 false，并保留 name/compat/input', () => {
  const userSection = {
    providers: {
      route: {
        models: [
          {
            id: 'a',
            name: 'A',
            compat: { thinkingFormat: 'openai' },
            reasoningEfforts: { high: 'high' },
            input: ['text', 'image'],
          },
        ],
      },
    },
  }
  const plan = cap.buildModelOps({
    userSection,
    settingsPath: PATH,
    edits: [{ id: 'a', draft: cap.emptyDraft() }],
  })
  assert.deepEqual(plan.issues, [])
  assert.deepEqual(plan.ops, [
    {
      op: 'set',
      path: ['providers', 'route', 'models'],
      value: [
        {
          id: 'a',
          name: 'A',
          compat: { thinkingFormat: 'openai' },
          reasoningEfforts: false,
          input: ['text', 'image'],
        },
      ],
    },
  ])
})

test('fieldValuesFromDraft: manageReasoning=false 不产生字段、也不报档位问题', () => {
  const { values, issues } = cap.fieldValuesFromDraft(
    'm',
    { reasoning: { off: '', high: 'high' } },
    { manageReasoning: false },
  )
  assert.deepEqual(issues, [])
  assert.deepEqual(values, {})
})

test('buildModelOps: manageReasoning=false 的编辑不产生 op（DeepSeek 没有插件可写字段）', () => {
  const plan = cap.buildModelOps({
    userSection: {
      providers: {
        route: {
          models: [{ id: 'deepseek-v4-flash', inputModalities: ['text', 'image'], name: 'Flash' }],
        },
      },
    },
    settingsPath: PATH,
    manageReasoning: false,
    edits: [{ id: 'deepseek-v4-flash', draft: cap.emptyDraft() }],
  })
  assert.deepEqual(plan.issues, [])
  assert.deepEqual(plan.ops, [])
})

test('buildModelOps: manageReasoning=false 绝不为空改动物化 models', () => {
  const plan = cap.buildModelOps({
    userSection: {},
    settingsPath: PATH,
    visibleModelIds: ['a'],
    manageReasoning: false,
    edits: [{ id: 'a', draft: { reasoning: { high: 'high' } } }],
  })
  assert.deepEqual(plan.issues, [])
  assert.deepEqual(plan.ops, [])
})

// ---------------------------------------------------------------------------
// 预置 / 目录 / 常量
// ---------------------------------------------------------------------------

test('协议预置：两家默认都勾 off/low/high/max，档位词表不同', () => {
  const ticked = { off: '', low: 'low', high: 'high', max: 'max' }
  assert.deepEqual(cap.reasoningPreset('openai'), ticked)
  assert.deepEqual(cap.reasoningPreset('anthropic'), ticked)
  assert.equal(cap.DEFAULT_REASONING_PRESET, 'openai')
  assert.deepEqual(cap.presetLevels('openai'), ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
  assert.deepEqual(cap.presetLevels('anthropic'), ['off', 'low', 'medium', 'high', 'xhigh', 'max'])
})

test('协议预置落盘只填档位表，绝不写 compat', () => {
  const plan = cap.buildModelOps({
    userSection: { providers: { route: { models: [{ id: 'a' }] } } },
    settingsPath: PATH,
    edits: [{ id: 'a', draft: { reasoning: cap.reasoningPreset('anthropic') } }],
  })
  assert.deepEqual(plan.issues, [])
  assert.deepEqual(plan.ops[0].value[0].reasoningEfforts, {
    off: null,
    low: 'low',
    high: 'high',
    max: 'max',
  })
  for (const op of plan.ops) assert.equal(op.path.includes('compat'), false)
})

test('协议预置声明的 minimal / xhigh / max 都能落盘', () => {
  const plan = cap.buildModelOps({
    userSection: { providers: { route: { models: [{ id: 'a' }] } } },
    settingsPath: PATH,
    edits: [
      {
        id: 'a',
        draft: {
          reasoning: {
            off: '',
            minimal: 'minimal',
            low: 'low',
            medium: 'medium',
            high: 'high',
            xhigh: 'xhigh',
            max: 'max',
          },
        },
      },
    ],
  })
  assert.deepEqual(plan.issues, [])
  assert.deepEqual(plan.ops[0].value[0].reasoningEfforts, {
    off: null,
    minimal: 'minimal',
    low: 'low',
    medium: 'medium',
    high: 'high',
    xhigh: 'xhigh',
    max: 'max',
  })
})

test('listStoredModels: models[] 优先，其次 modelOverrides 键', () => {
  assert.deepEqual(cap.listStoredModels({}, PATH), [])
  const stored = cap.listStoredModels(
    {
      providers: {
        route: {
          models: [{ id: 'a', name: 'A' }, { id: 'b' }],
          modelOverrides: { c: { name: 'C' } },
        },
      },
    },
    PATH,
  )
  assert.deepEqual(
    stored.map((model) => model.id),
    ['a', 'b', 'c'],
  )
  assert.equal(stored[0].entry.name, 'A')
})

test('CAPACITY_PRESETS: 第一个就是 1M / 128K 的确切值', () => {
  assert.deepEqual(cap.CAPACITY_PRESETS[0], {
    label: '1M / 128K',
    contextWindow: '1000000',
    maxTokens: '131072',
  })
})

// ---------------------------------------------------------------------------
// DSH 契约防漂移
//
// 本插件的失效模式全是**静默**的：服务名 / slot 键 / 事件名 / DOM 类名写错，
// cordis 与 tsc 都不报错，只是永不激活或什么都不注入（详见 README 的
// 「DSH 兼容性」一节）。所以这里把用到的官方契约面钉成自测：
// 1. 插件源码里的名字（不需要 DSH 部署，永远跑）；
// 2. 官方产物里的原文（需要一份完整 DSH 安装，按环境变量给路径）。
// 官方片段消失 = 该契约已漂移，自测必须报红。
// ---------------------------------------------------------------------------

test('契约面：插件源码里的服务名 / slot 键 / 事件名 / DOM 判据', () => {
  const clientIndex = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')
  const clientTypes = readFileSync(new URL('../src/client/types.ts', import.meta.url), 'utf8')
  const augment = readFileSync(new URL('../src/client/augment.ts', import.meta.url), 'utf8')
  const anchor = readFileSync(new URL('../src/client/anchor.tsx', import.meta.url), 'utf8')
  const capabilitySource = readFileSync(new URL('../src/client/capability.ts', import.meta.url), 'utf8')

  // inject 的四个名字：官方客户端各自 provide / mount 的真实服务名。
  assert.match(clientIndex, /export const inject = \['slots', 'locale', 'remote', 'remote\.settings'\]/)
  // keyed slot 的键必须等于提供方的 settingsNs（官方按 entryKey 派发）。
  assert.ok(clientIndex.includes("'settings.models.provider-card'"), 'slot 键')
  assert.ok(
    clientIndex.includes("PROVIDER_CARD_KEYS = ['llm-pi-ai', 'llm-deepseek']"),
    '提供方 settingsNs',
  )
  // 官方 remote 事件名（白名单常量 API_REMOTE_FORWARDED_EVENTS 的成员）。
  assert.ok(clientIndex.includes("'settings/document-updated'"), '设置变更事件名')
  // locale 的非类型化三参 register + bind。
  assert.ok(clientTypes.includes('register(ns: string, locale: string, dict: Record<string, string>): unknown'))
  assert.ok(clientTypes.includes('bind(ns: string):'), 'locale.bind')

  // DOM 判据：官方 CSS Module 的局部名（插件按子串匹配，哈希前缀不参与）。
  for (const fragment of [
    '_rowCard',
    '_setupCard',
    '_modelEntry',
    '_modelList',
    '_modelAdvanced',
    '_modelRow',
    '_editorActions',
  ]) {
    assert.ok(augment.includes(fragment), 'augment.ts 丢了 DOM 判据 ' + fragment)
  }
  assert.ok(augment.includes('input[type="text"], input:not([type])'), '模型 ID 输入框判据')

  // 思考强度由插件自己的预置 UI 管理：pi-ai 恒定由插件维护，不跟随官方原生控件。
  assert.ok(augment.includes('const manageReasoning = !isDeepSeek'), 'pi-ai 的每模型 reasoningEfforts 归插件管')
  assert.ok(augment.includes('if (manageReasoning) {'), '放置点按 manageReasoning 建思考控件')
  assert.ok(augment.includes('dataset.dshMcHideNativeReasoning'), '注入后给行打标隐藏官方原生推理控件')
  assert.ok(augment.includes('delete state.row.dataset.dshMcHideNativeReasoning'), '卸载时清理隐藏标记')
  assert.equal(augment.includes('officialManaged'), false, '不得再按官方归属过滤写入')
  assert.equal(clientIndex.includes('llm-deepseek-account'), false, '不得再为 account 路由挂提供方面板')

  // 官方原生推理控件（0.2.1 给 hand-declared 路由渲染）由样式表按行标记隐藏。
  const styles = readFileSync(new URL('../src/client/styles.ts', import.meta.url), 'utf8')
  assert.ok(
    styles.includes('[data-dsh-mc-hide-native-reasoning] [class*="_modelReasoning"]'),
    '样式表按行标记隐藏官方原生推理控件',
  )
  assert.ok(styles.includes('display:none!important'), '隐藏规则必须压过官方 display')

  // 0.1.1 起不再注入 / 维护官方已有的多模态控件（官方 ModelInputTypes 负责）。
  assert.equal(augment.includes('dshMc_radios'), false, '不得再注入多模态 radio')
  assert.equal(augment.includes('inputRadios'), false, '不得再维护多模态控件状态')

  // 只写 reasoningEfforts：applyValues 不得再写 input / inputModalities。
  assert.ok(capabilitySource.includes('next.reasoningEfforts = values.reasoningEfforts'), '只写 reasoningEfforts')
  assert.equal(/next\.input(Modalities)?\s*=/.test(capabilitySource), false, '不得再写 input / inputModalities')

  // 席位列出的锚点必须仍是隐藏的 span（面板 / 可见 UI 都在行内注入里）。
  assert.ok(anchor.includes('hidden data-dsh-mc-anchor'), '席位只渲染隐藏锚点')
  assert.equal(anchor.includes('ProviderReasoningPanel'), false, '提供方级面板已删除')

  // 已删除的非 bug 修复模块不得被重新引入（纯逻辑自测无法覆盖文件存在性）。
  assert.equal(existsSync(new URL('../src/client/provider-panel.tsx', import.meta.url)), false, 'provider-panel 应已删除')
  assert.equal(existsSync(new URL('../src/shared/provider-reasoning.ts', import.meta.url)), false, 'provider-reasoning 应已删除')
})

// ---------------------------------------------------------------------------
// 兼容闸门自身的回归：官方产物路径解析
//
// 0.2.1 起 dsh-api-gateway 的 client 产物被拆成 client.browser.js /
// client.node.js（exports["./client"] 按条件映射），固定文件路径断言会误报。
// 这里用临时目录模拟各版本布局，确保解析器在没有 DSH 部署的 CI 上也跑得起来。
// ---------------------------------------------------------------------------

test('官方产物解析：0.2.0 旧布局 / 0.2.1 exports 条件 / 缺失返回 undefined', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-contract-'))
  try {
    const write = (packageName, files) => {
      for (const [relative, content] of Object.entries(files)) {
        const file = join(root, packageName, ...relative.split('/'))
        mkdirSync(dirname(file), { recursive: true })
        writeFileSync(file, content)
      }
    }
    const manifest = (exportsValue) => JSON.stringify({ exports: exportsValue })

    // 0.2.0：exports["./client"] 直接 default 到固定的 lib/client.js。
    write('legacy-layout', {
      'package.json': manifest({ './client': { types: './lib/types/client/index.d.ts', default: './lib/client.js' } }),
      'lib/client.js': 'LEGACY',
    })
    // 0.2.1：exports["./client"] 按 node / browser / default 条件拆成两份产物。
    write('split-layout', {
      'package.json': manifest({
        './client': {
          types: './lib/types/client/index.d.ts',
          node: './lib/client.node.js',
          browser: './lib/client.browser.js',
          default: './lib/client.browser.js',
        },
      }),
      'lib/client.browser.js': 'BROWSER',
      'lib/client.node.js': 'NODE',
      'lib/client.js': 'STALE',
    })
    // 没有 package.json：回退固定文件名；再退到 lib/client*.js（browser 优先、node 垫底）。
    write('no-manifest', { 'lib/client.browser.js': 'BROWSER' })
    write('glob-only', { 'lib/client.node.js': 'NODE' })
    // exports 指向的文件不存在：回退仍然成立。
    write('broken-exports', {
      'package.json': manifest({ './client': { browser: './lib/missing.js', default: './lib/missing.js' } }),
      'lib/client.js': 'LEGACY',
    })
    // 0.2.1 的 SlotCore 内联在 web 前端 dist 产物里（包本身不在 npm 完整安装中）。
    write('web-frontend', { 'dist/assets/index-abc123.js': 'SEEDED' })

    const legacy = resolveOfficialArtifact(root, { package: 'legacy-layout' })
    assert.equal(legacy, join(root, 'legacy-layout', 'lib', 'client.js'))

    const split = resolveOfficialArtifact(root, { package: 'split-layout' })
    assert.equal(
      split,
      join(root, 'split-layout', 'lib', 'client.browser.js'),
      'browser 条件必须优先于 node 条件与同样存在的 client.js',
    )

    assert.equal(
      resolveOfficialArtifact(root, { package: 'no-manifest' }),
      join(root, 'no-manifest', 'lib', 'client.browser.js'),
    )
    assert.equal(resolveOfficialArtifact(root, { package: 'glob-only' }), join(root, 'glob-only', 'lib', 'client.node.js'))
    assert.equal(
      resolveOfficialArtifact(root, { package: 'broken-exports' }),
      join(root, 'broken-exports', 'lib', 'client.js'),
    )
    assert.equal(resolveOfficialArtifact(root, { package: 'does-not-exist' }), undefined)

    const fallbackFact = {
      artifact: { package: 'not-installed', entry: './client', fallbacks: ['web-frontend/dist/assets/index-*.js'] },
    }
    assert.equal(resolveFactFile(root, fallbackFact), join(root, 'web-frontend', 'dist', 'assets', 'index-abc123.js'))
    assert.equal(resolveFactFile(root, { path: 'nope.js' }), undefined)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

/**
 * 官方产物里必须逐字出现的契约原文（任一片段消失 = 契约漂移）。
 * path 相对 <部署>/node_modules/@deepseek-ai。
 */

// 官方 gateway 产物里有一行反引号模板串（service key 的构造）；本文件不能含
// 反引号（自测自身也要保持纯文本可读），所以用字符码拼出来断言。
const REMOTE_SERVICE_KEY_RETURN = 'return ' + TICK + 'remote.' + DOLLAR + '{namespace}' + TICK + ';'

const OFFICIAL_CONTRACT_FACTS = [
  {
    name: 'remote / remote.settings 是 traced 客户端服务（服务键 remote.<namespace>）',
    artifact: { package: 'dsh-api-gateway', entry: './client' },
    includes: [
      'function remoteServiceKey(namespace)',
      REMOTE_SERVICE_KEY_RETURN,
      'super(ctx, remoteServiceKey(name));',
      'super(ctx, "remote");',
    ],
  },
  {
    name: 'settings 命名空间由官方 remote 装配挂载',
    path: 'dsh-api-remotes/lib/types/client/index.js',
    includes: ['settingsControllerRemote', 'disposers.push(await ctx.remote.$mount(contribution));'],
  },
  {
    name: 'remote.settings.describe / mutate 一元签名与 RemoteResult 分支',
    path: 'dsh-api-settings-controller/lib/typert.remote-client.d.ts',
    includes: [
      "'settings': TypertRemoteNamespace$73657474696e6773",
      'describe: () => Promise<RemoteResult<SettingsDescribeValue>>',
      'mutate: (ns: string, ops: SettingsPathOpView[], expectedRevision: number | undefined) => Promise<RemoteResult<SettingsNamespaceView>>',
    ],
  },
  {
    name: 'settings/document-updated 的声明形状 (ns, revision) 与 describe 返回形状',
    path: 'dsh-settings/lib/types/types.d.ts',
    includes: [
      "'settings/document-updated'(ns: SettingsNamespace, revision: number): void;",
      'namespaces: SettingsNamespaceView[];',
      'writable: boolean;',
      'user?: JsonValue;',
    ],
  },
  {
    name: '事件转发保留原始实参顺序（...frame.args）',
    artifact: { package: 'dsh-api-gateway', entry: './client' },
    includes: ['privateEvents(this.ownerCtx).parallel(this.eventKey(frame.event), ...frame.args)'],
  },
  {
    name: 'settings/document-updated 在 host 转发白名单里，且实参按序转发',
    path: 'dsh-api-remotes/lib/index.js',
    includes: ['"settings/document-updated"', 'args: assertJsonArgs(event, args)'],
  },
  {
    name: 'settings.models.provider-card：keyed + entryKey=settingsNs + owner props',
    path: 'dsh-client-ui-settings-models/lib/types/client/slot-contract.d.ts',
    includes: [
      "'settings.models.provider-card':",
      "kind: 'keyed';",
      'owner: ProviderCardExtrasOwnerProps;',
      'provider: ProviderDirectoryEntry;',
      'configured: boolean;',
      'keyConfigured: boolean;',
    ],
  },
  {
    name: 'ProviderDirectoryEntry.settingsNs / settingsPath / declared',
    path: 'dsh-client-ui-settings-models/lib/types/client/store.d.ts',
    includes: ['readonly settingsNs: string;', 'readonly settingsPath: readonly string[];', 'readonly declared?: boolean;'],
  },
  {
    name: 'DOM 判据：模型行的 CSS Module 局部名仍在这 7 个',
    path: 'dsh-client-ui-settings-models/lib/client.js',
    includes: ['_rowCard', '_setupCard', '_modelEntry', '_modelList', '_modelAdvanced', '_modelRow', '_editorActions'],
  },
  {
    name: '官方模型行从 0.2.0 起就原生渲染输入类型控件 ModelInputTypes（插件不得重复注入多模态）',
    path: 'dsh-client-ui-settings-models/lib/client.js',
    includes: ['function ModelInputTypes(', 'modelInputTypes'],
  },
  {
    name: 'slots 服务名与 slots.inject(key, callback) / keyed 必填 key',
    path: 'dsh-client-ui-renderer/lib/client.js',
    includes: ['super(ctx, "slots");', 'inject(key, callback) {'],
  },
  {
    name: 'keyed slot 注册必须带 key（插件正是按 key 挂两个提供方）',
    // 0.2.0 的 SlotCore 在独立包 dsh-client-ui-slots；0.2.1 起该包只是渲染层的
    // devDependency（npm 完整安装里没有），SlotCore 被内联进 web 前端种子模块产物，
    // 所以先按包解析，缺失时回退到前端 dist 里找同一段 keyed 校验。
    artifact: {
      package: 'dsh-client-ui-slots',
      entry: '.',
      fallbacks: ['dsh-web-frontend/dist/assets/index-*.js'],
    },
    includes: ['keyed slot', 'requires options.key'],
  },
  {
    name: 'locale 服务是 ctx.provide 的，且三参 register / bind 都在',
    path: 'dsh-client-locale/lib/client.js',
    includes: ['ctx.provide("locale", locale);', 'register(ns, localeOrDicts, dict) {', 'bind(ns) {'],
  },
  {
    name: 'locale 非类型化三参 register 与 bind 的声明',
    path: 'dsh-client-locale/lib/types/client/index.d.ts',
    includes: ['register(ns: string, locale: string, dict: LocaleDict): () => void;', 'bind(ns: string): Translate;'],
  },
  {
    name: 'llm-pi-ai 模型字段 input / reasoningEfforts（插件写入的字段名）',
    path: 'dsh-llm-pi-ai/lib/types/catalog.d.ts',
    includes: ['input?: PiAiModality[];', 'reasoningEfforts?: false | PiAiReasoningEfforts;'],
  },
  {
    name: 'llm-deepseek 模型字段 inputModalities（官方控件写入，插件不写）',
    path: 'dsh-llm-deepseek/lib/index.js',
    includes: ['inputModalities: z.array(z.union(MODEL_MODALITIES)).min(1).default(["text"])'],
  },
  {
    name: '两个提供方 entry id 仍是插件注册席位用的 llm-pi-ai / llm-deepseek',
    path: 'dsh-base/cordis.patch.yml',
    includes: ['- id: llm-pi-ai', '- id: llm-deepseek'],
  },
]

/**
 * 顺序 / 结构判据：单纯「包含」表达不了的契约。
 * @returns 失败原因；通过时 undefined。
 */
const OFFICIAL_STRUCTURE_CHECKS = [
  {
    name: '编辑器动作行 _editorActions 里取消在提交之前（插件取 buttons[0] / 最后一个）',
    path: 'dsh-client-ui-settings-models/lib/client.js',
    check(source) {
      const start = source.indexOf('function EditorFooter(props)')
      if (start < 0) return 'missing function EditorFooter(props)'
      const body = source.slice(start, start + 1600)
      const cancel = body.indexOf('secondaryButton')
      const submit = body.indexOf('primaryButton')
      if (cancel < 0 || submit < 0) return 'missing secondaryButton / primaryButton'
      return cancel < submit ? undefined : 'primaryButton precedes secondaryButton'
    },
  },
  {
    name: '展开区仍是 contextWindow / maxTokens 两个容量 input 在前（插件取 advanced 里前两个 input）',
    path: 'dsh-client-ui-settings-models/lib/client.js',
    check(source) {
      const start = source.indexOf('function ModelRow(props)')
      if (start < 0) return 'missing function ModelRow(props)'
      const region = source.indexOf('//#region', start + 1)
      const body = source.slice(start, region < 0 ? start + 8000 : region)
      const advanced = body.indexOf('["modelAdvanced"]')
      const capacity = body.indexOf('["contextWindow", "maxTokens"].map')
      const inputTypes = body.indexOf('(ModelInputTypes,')
      if (advanced < 0) return 'missing modelAdvanced expanded region'
      if (capacity < 0) return 'missing contextWindow / maxTokens capacity inputs'
      if (inputTypes < 0) return 'missing ModelInputTypes control'
      if (capacity < advanced) return 'capacity inputs are no longer inside modelAdvanced'
      if (inputTypes < capacity) return 'input-type control no longer follows the capacity inputs'
      return undefined
    },
  },
]

/** 把环境变量给的一项收成「直接含 @deepseek-ai 的那层目录」。 */
function officialRootOf(entry) {
  const direct = join(entry, 'node_modules/@deepseek-ai')
  if (existsSync(direct)) return direct
  if (existsSync(entry) && entry.replace(/[\\/]+$/, '').endsWith('@deepseek-ai')) return entry
  return undefined
}

/**
 * 读官方包的 package.json（只当 JSON 读，不 import 官方包本身）。
 * @returns 解析结果；包目录或 package.json 不存在 / 不是合法 JSON 时 undefined。
 */
function readOfficialPackageJson(root, packageName) {
  const file = join(root, packageName, 'package.json')
  if (!existsSync(file)) return undefined
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * 从 exports 的目标值里按条件优先级取第一个字符串目标（支持条件对象 / 数组嵌套）。
 * @param target - exports 目标（字符串 / 条件对象 / 数组）。
 * @param conditions - 条件名，按优先级排列。
 * @returns 相对包目录的目标路径；解析不到时 undefined。
 */
function pickExportTarget(target, conditions) {
  if (typeof target === 'string') return target
  if (Array.isArray(target)) {
    for (const item of target) {
      const picked = pickExportTarget(item, conditions)
      if (picked !== undefined) return picked
    }
    return undefined
  }
  if (target === null || typeof target !== 'object') return undefined
  for (const condition of conditions) {
    if (!Object.hasOwn(target, condition)) continue
    const picked = pickExportTarget(target[condition], conditions)
    if (picked !== undefined) return picked
  }
  return undefined
}

/**
 * 解析官方包浏览器半区产物的真实文件。
 *
 * 0.2.1 起 exports["./client"] 按条件把浏览器 / Node 两份产物拆开
 * （dsh-api-gateway 变成 lib/client.browser.js + lib/client.node.js，
 * 文件名不再固定为 lib/client.js）；这里按 exports 条件的
 * browser -> default -> node 顺序解析真实文件，再回退 0.2.0 的固定布局
 * （lib/client.browser.js / lib/client.js）与 lib/client*.js。
 * 只把 package.json 当 JSON 读，不 import 官方包，0.2.0 旧部署同样可用。
 * @returns 绝对路径；包缺失或解析不到时 undefined。
 */
function resolveOfficialArtifact(root, artifact) {
  const packageDir = join(root, artifact.package)
  const packageJson = readOfficialPackageJson(root, artifact.package)
  const entry = artifact.entry ?? './client'
  const target =
    packageJson !== undefined && packageJson.exports !== null && typeof packageJson.exports === 'object'
      ? pickExportTarget(packageJson.exports[entry], ['browser', 'default', 'node'])
      : undefined
  if (target !== undefined) {
    const file = join(packageDir, target)
    if (existsSync(file)) return file
  }
  for (const name of ['lib/client.browser.js', 'lib/client.js']) {
    const file = join(packageDir, name)
    if (existsSync(file)) return file
  }
  const libDir = join(packageDir, 'lib')
  let names
  try {
    names = readdirSync(libDir)
  } catch {
    return undefined
  }
  const rank = (name) => (name.includes('browser') ? 0 : name === 'client.js' ? 1 : name.includes('node') ? 3 : 2)
  const candidates = names
    .filter((name) => name.startsWith('client') && name.endsWith('.js'))
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
  return candidates.length === 0 ? undefined : join(libDir, candidates[0])
}

/**
 * 展开相对部署根的单层通配路径（只支持最后一段含一个 *，够覆盖前端 dist 产物）。
 * @returns 匹配到的绝对路径（按名称排序，保证确定性）。
 */
function expandOfficialGlob(root, pattern) {
  const segments = pattern.split('/')
  const last = segments.pop()
  if (last === undefined) return []
  const star = last.indexOf('*')
  if (star < 0) {
    const file = join(root, ...segments, last)
    return existsSync(file) ? [file] : []
  }
  if (last.indexOf('*', star + 1) !== -1) throw new Error('不支持多段通配：' + pattern)
  const prefix = last.slice(0, star)
  const suffix = last.slice(star + 1)
  const dir = join(root, ...segments)
  let names
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  return names
    .filter((name) => name.length >= prefix.length + suffix.length && name.startsWith(prefix) && name.endsWith(suffix))
    .sort()
    .map((name) => join(dir, name))
}

/**
 * 把一条官方契约事实解析成实际要读的文件：artifact 走 exports / 固定布局 / glob 回退。
 * @returns 绝对路径；解析不到时 undefined。
 */
function resolveFactFile(root, fact) {
  if (fact.artifact === undefined) {
    const file = join(root, fact.path)
    return existsSync(file) ? file : undefined
  }
  const resolved = resolveOfficialArtifact(root, fact.artifact)
  if (resolved !== undefined) return resolved
  for (const pattern of fact.artifact.fallbacks ?? []) {
    const matched = expandOfficialGlob(root, pattern)
    if (matched.length > 0) return matched[0]
  }
  return undefined
}

/** 把一条事实的来源描述成便于排查的文案。 */
function describeFactSource(fact) {
  if (fact.artifact === undefined) return fact.path
  const entry = fact.artifact.entry ?? './client'
  const fallbacks = (fact.artifact.fallbacks ?? []).map((pattern) => '；回退 ' + pattern).join('')
  return fact.artifact.package + ' 的 ' + entry + ' 导出（按 browser/default/node 解析）' + fallbacks
}

/** 从环境变量解析要核对的 DSH 部署（可多份，用路径分隔符列表给 DSH_CONTRACT_HOMES）。 */
function resolveOfficialRoots() {
  const delimiter = process.platform === 'win32' ? ';' : ':'
  const roots = []
  for (const key of ['DSH_CONTRACT_HOMES', 'DSH_CONTRACT_HOME', 'DSH_STABLE_HOME', 'DSH_017_HOME']) {
    const value = process.env[key]
    if (value === undefined || value.length === 0) continue
    for (const entry of value.split(delimiter)) {
      if (entry.length === 0) continue
      const root = officialRootOf(entry)
      if (root !== undefined && !roots.includes(root)) roots.push(root)
    }
  }
  return roots
}

const officialRoots = resolveOfficialRoots()
if (officialRoots.length === 0) {
  console.log(
    '  info 未提供 DSH_CONTRACT_HOME / DSH_CONTRACT_HOMES / DSH_STABLE_HOME / DSH_017_HOME：' +
      '跳过官方产物契约核对（只跑插件源码侧的名字断言）',
  )
} else {
  for (const root of officialRoots) {
    test('官方契约原文 @ ' + root, () => {
      for (const fact of OFFICIAL_CONTRACT_FACTS) {
        const file = resolveFactFile(root, fact)
        assert.ok(
          file !== undefined,
          '缺少官方产物 ' + describeFactSource(fact) + '（exports 条件解析与旧布局回退都没命中）',
        )
        const source = readFileSync(file, 'utf8')
        for (const fragment of fact.includes) {
          assert.ok(
            source.includes(fragment),
            fact.name + '：' + describeFactSource(fact) + ' 里找不到 ' + JSON.stringify(fragment),
          )
        }
      }
      for (const structure of OFFICIAL_STRUCTURE_CHECKS) {
        const file = join(root, structure.path)
        assert.ok(existsSync(file), '缺少官方产物 ' + structure.path)
        const source = readFileSync(file, 'utf8')
        const failure = structure.check(source)
        assert.equal(failure, undefined, structure.name + '：' + (failure ?? ''))
      }
    })
  }
}

// ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.error('')
  console.error(failures.length + ' of ' + (passed + failures.length) + ' checks failed')
  process.exit(1)
}
console.log('')
console.log('all ' + passed + ' checks passed')
