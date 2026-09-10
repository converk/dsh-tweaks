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
import { existsSync } from 'node:fs'
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

test('THINKING_LEVELS: 只有 off/low/medium/high/max 五档', () => {
  assert.deepEqual(Array.from(cap.THINKING_LEVELS), ['off', 'low', 'medium', 'high', 'max'])
})

test('draftFromEntry: 完整条目还原成草稿（忽略 minimal/xhigh）', () => {
  const draft = cap.draftFromEntry({
    id: 'glm-5.3',
    reasoningEfforts: { off: null, minimal: 'minimal', high: 'high', max: 'max', xhigh: 'xhigh' },
    input: ['text', 'image'],
  })
  assert.deepEqual(draft.reasoning, { off: '', high: 'high', max: 'max' })
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

test('协议预置只填档位表，绝不写 compat', () => {
  assert.deepEqual(cap.reasoningPreset('anthropic'), {
    off: '',
    low: 'low',
    medium: 'medium',
    high: 'high',
    max: 'max',
  })
  const plan = cap.buildModelOps({
    userSection: { providers: { route: { models: [{ id: 'a' }] } } },
    settingsPath: PATH,
    edits: [{ id: 'a', draft: { reasoning: cap.reasoningPreset('anthropic') ?? {}, input: 'text' } }],
  })
  assert.deepEqual(plan.issues, [])
  assert.deepEqual(plan.ops[0].value[0].reasoningEfforts, {
    off: null,
    low: 'low',
    medium: 'medium',
    high: 'high',
    max: 'max',
  })
  for (const op of plan.ops) assert.equal(op.path.includes('compat'), false)
})

test('matchReasoningPreset: 回显匹配的预置', () => {
  assert.equal(cap.matchReasoningPreset(cap.reasoningPreset('anthropic') ?? {}), 'anthropic')
  assert.equal(cap.matchReasoningPreset({ off: '', high: 'high' }), undefined)
  assert.equal(cap.matchReasoningPreset({}), undefined)
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

if (failures.length > 0) {
  console.error(`\n${failures.length} of ${passed + failures.length} checks failed`)
  process.exit(1)
}
console.log(`\nall ${passed} checks passed`)
