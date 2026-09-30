/**
 * dsh-tweaks-model-capabilities 纯逻辑自测。
 *
 * 只测 `lib/capability.js`（由 `node build.mjs` 产出），不碰 DOM / React / DSH：
 *   node build.mjs && node scripts/selftest.mjs
 *
 * 覆盖：只有 5 档；一个档都不勾 = 不支持思考（false）；只勾 off 被拒；
 * 非 off 档空拼写被拒；未勾选档不写键；多模态始终显式；models[] 数组模式保留
 * 其它条目与 name/compat；没有 models[] 时用官方编辑器可见 id 完整物化并删
 * modelOverrides；未保存模型被拒；协议预置只填档位表、绝不写 compat。
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const modulePath = new URL('../lib/capability.js', import.meta.url)
if (!existsSync(modulePath)) {
  console.error(`missing ${fileURLToPath(modulePath)}; run "node build.mjs" first`)
  process.exit(2)
}
const cap = await import(modulePath.href)

let passed = 0
const failures = []

/** 跑一个用例；失败不中断，最后统一退出码。 */
function test(name, run) {
  try {
    run()
    passed += 1
    console.log(`ok - ${name}`)
  } catch (error) {
    failures.push({ name, error })
    console.error(`not ok - ${name}`)
    console.error(error)
  }
}

/** 标准 profile 路径。 */
const PATH = ['providers', 'route']

// ---------------------------------------------------------------------------
// 档位 / 草稿
// ---------------------------------------------------------------------------

test('THINKING_LEVELS: 两家协议词表的并集（按升级顺序）', () => {
  assert.deepEqual(Array.from(cap.THINKING_LEVELS), ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
})

test('draftFromEntry: 完整条目还原成草稿（含 minimal/xhigh）', () => {
  const draft = cap.draftFromEntry({
    id: 'glm-5.3',
    reasoningEfforts: { off: null, minimal: 'minimal', high: 'high', max: 'max', xhigh: 'xhigh' },
    input: ['text', 'image'],
  })
  assert.deepEqual(draft.reasoning, { off: '', minimal: 'minimal', high: 'high', max: 'max', xhigh: 'xhigh' })
  assert.equal(draft.input, 'text+image')
})

test('draftFromEntry: false / 空 input / 文本 input', () => {
  assert.deepEqual(cap.draftFromEntry({ reasoningEfforts: false }), { reasoning: {}, input: 'text' })
  assert.deepEqual(cap.draftFromEntry({ input: [] }), { reasoning: {}, input: 'text' })
  assert.deepEqual(cap.draftFromEntry({ input: ['text'] }), { reasoning: {}, input: 'text' })
  assert.deepEqual(cap.draftFromEntry(undefined), cap.emptyDraft())
})

test('fieldValuesFromDraft: 一个档都不勾 = 不支持思考（false）+ 仅文本', () => {
  const { values, issues } = cap.fieldValuesFromDraft('m', cap.emptyDraft())
  assert.deepEqual(issues, [])
  assert.equal(values.reasoningEfforts, false)
  assert.deepEqual(values.input, ['text'])
})

test('fieldValuesFromDraft: off 留空写 null，非 off 原样写拼写', () => {
  const { values, issues } = cap.fieldValuesFromDraft('m', {
    reasoning: { off: '', low: 'low', high: 'high', max: 'ultra' },
    input: 'follow',
  })
  assert.deepEqual(issues, [])
  assert.deepEqual(values.reasoningEfforts, { off: null, low: 'low', high: 'high', max: 'ultra' })
  assert.deepEqual(values.input, ['text'])
})

test('fieldValuesFromDraft: 未勾选档不写键（= 本体钉成不支持）', () => {
  const { values } = cap.fieldValuesFromDraft('m', {
    reasoning: { off: '', high: 'high' },
    input: 'text+image',
  })
  assert.equal(Object.prototype.hasOwnProperty.call(values.reasoningEfforts, 'medium'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(values.reasoningEfforts, 'low'), false)
  assert.deepEqual(Object.keys(values.reasoningEfforts), ['off', 'high'])
  assert.deepEqual(values.input, ['text', 'image'])
})

test('fieldValuesFromDraft: 只勾 off 被拒', () => {
  const { issues } = cap.fieldValuesFromDraft('m', { reasoning: { off: '' }, input: 'text' })
  assert.deepEqual(
    issues.map((issue) => issue.code),
    ['reasoning-only-off'],
  )
})

test('fieldValuesFromDraft: 非 off 档空拼写被拒', () => {
  const { issues } = cap.fieldValuesFromDraft('m', {
    reasoning: { off: '', high: '   ' },
    input: 'text',
  })
  assert.deepEqual(
    issues.map((issue) => issue.code),
    ['reasoning-wire-required'],
  )
  assert.equal(issues[0].level, 'high')
})

test('validateDraft: 模型 ID 不能为空', () => {
  assert.deepEqual(
    cap.validateDraft('   ', cap.emptyDraft()).map((issue) => issue.code),
    ['model-id-empty'],
  )
})

test('draftsEqual / copyDraft', () => {
  const a = cap.emptyDraft()
  const b = { ...cap.emptyDraft(), input: 'text+image' }
  assert.equal(cap.draftsEqual(a, cap.emptyDraft()), true)
  assert.equal(cap.draftsEqual(a, b), false)
  const custom = { reasoning: { off: '', high: 'high' }, input: 'text' }
  const copy = cap.copyDraft(custom)
  assert.deepEqual(copy, custom)
  assert.notEqual(copy.reasoning, custom.reasoning)
})

// ---------------------------------------------------------------------------
// buildModelOps：数组模式 / 物化模式
// ---------------------------------------------------------------------------

test('buildModelOps: 用户层已有 models[] → 一次 set models，保留其它条目与 name/compat', () => {
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
          },
          { id: 'qwen3.8-flash', name: 'Qwen 3.8 Flash', description: 'keep me' },
        ],
      },
    },
  }
  const plan = cap.buildModelOps({
    userSection,
    settingsPath: PATH,
    edits: [
      {
        id: 'glm-5.3',
        draft: { reasoning: { off: '', high: 'high', max: 'ultra' }, input: 'text+image' },
      },
    ],
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
  assert.deepEqual(models[0].reasoningEfforts, { off: null, high: 'high', max: 'ultra' })
  assert.deepEqual(models[0].input, ['text', 'image'])
  // 官方编辑器写的上下文 / 最大输出必须原样保留（插件只动 reasoningEfforts / input）。
  assert.equal(models[0].contextWindow, 1000000)
  assert.equal(models[0].maxTokens, 131072)
  assert.equal(models[1].description, 'keep me')
})

test('buildModelOps: 用户层没有 models[] → 用可见 id 完整物化并删 modelOverrides', () => {
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
    edits: [{ id: 'a', draft: { reasoning: {}, input: 'text+image' } }],
  })
  assert.deepEqual(plan.issues, [])
  assert.deepEqual(plan.ops, [
    {
      op: 'set',
      path: ['providers', 'route', 'models'],
      value: [
        { id: 'a', reasoningEfforts: false, input: ['text', 'image'] },
        { id: 'b', name: 'B override', reasoningEfforts: { high: 'high' } },
        { id: 'c' },
      ],
    },
    { op: 'unset', path: ['providers', 'route', 'modelOverrides'] },
  ])
})

test('buildModelOps: 没有 models[] 也没有可见 id → models-not-configured', () => {
  const plan = cap.buildModelOps({
    userSection: {},
    settingsPath: PATH,
    edits: [{ id: 'a', draft: cap.emptyDraft() }],
  })
  assert.deepEqual(plan.ops, [])
  assert.deepEqual(
    plan.issues.map((issue) => issue.code),
    ['models-not-configured'],
  )
})

test('buildModelOps: 模型还没保存 → model-not-saved', () => {
  const plan = cap.buildModelOps({
    userSection: { providers: { route: { models: [{ id: 'a' }] } } },
    settingsPath: PATH,
    edits: [{ id: 'b', draft: cap.emptyDraft() }],
  })
  assert.deepEqual(plan.ops, [])
  assert.deepEqual(
    plan.issues.map((issue) => issue.code),
    ['model-not-saved'],
  )
  assert.equal(plan.issues[0].id, 'b')
})

test('buildModelOps: models 与 modelOverrides 并存 → storage-conflict', () => {
  const plan = cap.buildModelOps({
    userSection: { providers: { route: { models: [{ id: 'a' }], modelOverrides: { a: { input: ['text'] } } } } },
    settingsPath: PATH,
    edits: [],
  })
  assert.deepEqual(plan.ops, [])
  assert.deepEqual(
    plan.issues.map((issue) => issue.code),
    ['storage-conflict'],
  )
})

test('buildModelOps: 改动与已存值相同 → 不产生 op', () => {
  const userSection = {
    providers: { route: { models: [{ id: 'a', reasoningEfforts: { high: 'high' }, input: ['text'] }] } },
  }
  const plan = cap.buildModelOps({
    userSection,
    settingsPath: PATH,
    edits: [{ id: 'a', draft: { reasoning: { high: 'high' }, input: 'text' } }],
  })
  assert.deepEqual(plan.issues, [])
  assert.deepEqual(plan.ops, [])
})

test('buildModelOps: 清空档位 = 写 false，并保留 name/compat', () => {
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
    edits: [{ id: 'a', draft: { reasoning: {}, input: 'text' } }],
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
          input: ['text'],
        },
      ],
    },
  ])
})

// ---------------------------------------------------------------------------
// DeepSeek 命名空间：只有 inputModalities，没有每模型 reasoningEfforts
// ---------------------------------------------------------------------------

test('draftFromEntry: DeepSeek 用 inputModalities 字段', () => {
  const draft = cap.draftFromEntry({ inputModalities: ['text', 'image'] }, 'inputModalities')
  assert.equal(draft.input, 'text+image')
  assert.deepEqual(draft.reasoning, {})
  assert.equal(cap.draftFromEntry({ input: ['text', 'image'] }, 'inputModalities').input, 'text')
})

test('fieldValuesFromDraft: manageReasoning=false 时不产生 reasoningEfforts', () => {
  const { values, issues } = cap.fieldValuesFromDraft(
    'm',
    { reasoning: { off: '', high: 'high' }, input: 'text+image' },
    { manageReasoning: false },
  )
  assert.deepEqual(issues, [])
  assert.equal(values.reasoningEfforts, undefined)
  assert.deepEqual(values.input, ['text', 'image'])
})

test('buildModelOps: DeepSeek 只写 inputModalities，保留其它字段且不加 reasoningEfforts', () => {
  const userSection = {
    providers: {
      route: {
        models: [
          {
            id: 'deepseek-v4-flash-vision-exp',
            name: 'DeepSeek-V4-Flash-Vision-Exp',
            description: 'keep me',
            contextWindow: 1000000,
            maxTokens: 131072,
            inputModalities: ['text'],
            imagePixelBudget: 'low',
            imageMaxBytes: 1048576,
          },
        ],
      },
    },
  }
  const plan = cap.buildModelOps({
    userSection,
    settingsPath: PATH,
    inputField: 'inputModalities',
    manageReasoning: false,
    edits: [{ id: 'deepseek-v4-flash-vision-exp', draft: { reasoning: {}, input: 'text+image' } }],
  })
  assert.deepEqual(plan.issues, [])
  assert.deepEqual(plan.ops, [
    {
      op: 'set',
      path: ['providers', 'route', 'models'],
      value: [
        {
          id: 'deepseek-v4-flash-vision-exp',
          name: 'DeepSeek-V4-Flash-Vision-Exp',
          description: 'keep me',
          contextWindow: 1000000,
          maxTokens: 131072,
          inputModalities: ['text', 'image'],
          imagePixelBudget: 'low',
          imageMaxBytes: 1048576,
        },
      ],
    },
  ])
  assert.equal(Object.prototype.hasOwnProperty.call(plan.ops[0].value[0], 'reasoningEfforts'), false)
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
    edits: [{ id: 'a', draft: { reasoning: cap.reasoningPreset('anthropic'), input: 'text' } }],
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
          input: 'text',
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

  // inject 的四个名字：官方客户端各自 provide / mount 的真实服务名。
  assert.match(clientIndex, /export const inject = \['slots', 'locale', 'remote', 'remote\.settings'\]/)
  // keyed slot 的键必须等于提供方的 settingsNs（官方按 entryKey 派发）。
  assert.ok(clientIndex.includes("'settings.models.provider-card'"), 'slot 键')
  assert.ok(clientIndex.includes("PROVIDER_CARD_KEYS = ['llm-pi-ai', 'llm-deepseek']"), '提供方 settingsNs')
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
    assert.ok(augment.includes(fragment), `augment.ts 丢了 DOM 判据 ${fragment}`)
  }
  assert.ok(augment.includes('input[type="text"], input:not([type])'), '模型 ID 输入框判据')
})

/**
 * 官方产物里必须逐字出现的契约原文（任一片段消失 = 契约漂移）。
 * `path` 相对 `<部署>/node_modules/@deepseek-ai`。
 */
const OFFICIAL_CONTRACT_FACTS = [
  {
    name: 'remote / remote.settings 是 traced 客户端服务（服务键 remote.<namespace>）',
    path: 'dsh-api-gateway/lib/client.js',
    includes: [
      'function remoteServiceKey(namespace)',
      'return `remote.${namespace}`;',
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
    path: 'dsh-api-gateway/lib/client.js',
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
    name: 'DOM 判据：展开区仍是 contextWindow / maxTokens 两个 input 在前',
    path: 'dsh-client-ui-settings-models/lib/client.js',
    includes: [
      'className: ModelsSection_module_css_default["modelAdvanced"]',
      'children: [["contextWindow", "maxTokens"].map((field) =>',
    ],
  },
  {
    name: 'slots 服务名与 slots.inject(key, callback) / keyed 必填 key',
    path: 'dsh-client-ui-renderer/lib/client.js',
    includes: ['super(ctx, "slots");', 'inject(key, callback) {'],
  },
  {
    name: 'keyed slot 注册必须带 key（插件正是按 key 挂两个提供方）',
    path: 'dsh-client-ui-slots/lib/index.js',
    includes: ['if (options.key === void 0) throw new Error(`keyed slot "${options.name}" requires options.key`);'],
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
    name: 'llm-deepseek 模型字段 inputModalities（插件写入的字段名）',
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
]

/** 把环境变量给的一项收成「直接含 @deepseek-ai 的那层目录」。 */
function officialRootOf(entry) {
  const direct = join(entry, 'node_modules/@deepseek-ai')
  if (existsSync(direct)) return direct
  if (existsSync(entry) && entry.replace(/[\\/]+$/, '').endsWith('@deepseek-ai')) return entry
  return undefined
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
    test(`官方契约原文 @ ${root}`, () => {
      for (const fact of OFFICIAL_CONTRACT_FACTS) {
        const file = join(root, fact.path)
        assert.ok(existsSync(file), `缺少官方产物 ${fact.path}`)
        const source = readFileSync(file, 'utf8')
        for (const fragment of fact.includes) {
          assert.ok(
            source.includes(fragment),
            `${fact.name}：${fact.path} 里找不到 ${JSON.stringify(fragment)}`,
          )
        }
      }
      for (const structure of OFFICIAL_STRUCTURE_CHECKS) {
        const source = readFileSync(join(root, structure.path), 'utf8')
        const failure = structure.check(source)
        assert.equal(failure, undefined, `${structure.name}：${failure ?? ''}`)
      }
    })
  }
}

// ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.error(`\n${failures.length} of ${passed + failures.length} checks failed`)
  process.exit(1)
}
console.log(`\nall ${passed} checks passed`)
