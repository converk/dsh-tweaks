/**
 * DeepSeek 提供方级思考面板。
 *
 * `llm-deepseek` 的模型行由官方 `DeepSeekModelsEditor` 渲染；`llm-deepseek-account`
 * 在官方 0.2.1 的 `layoutOf` 里是 `unknown`，**没有模型行**可增补（0.2.0 曾把它当
 * deepseek family 渲染）。因此插件在提供方卡片里直接补一个根字段面板
 * （`thinking` / `reasoningEffort`），这是 account 路由唯一可编辑的思考入口。
 *
 * 只写命名空间根字段（两个官方 Config 都把这两个字段定义在根上）；不碰
 * models / modelOverrides，也不重复官方模型行的多模态或推理控件。
 */
import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import {
  emptyProviderReasoning,
  providerReasoningFrom,
  providerReasoningOps,
  validateProviderReasoning,
} from '../shared/provider-reasoning.js'
import type { ProviderReasoning } from '../shared/provider-reasoning.js'
import type { PanelProps, SettingsDescribeValueLike } from './types.js'

/** 面板内联样式（不依赖官方 CSS Module 的哈希类名）。 */
const fieldStyle = { display: 'grid', gap: 4, fontSize: 12 } as const
const rowStyle = { display: 'flex', gap: 8, alignItems: 'center' } as const
const selectStyle = { fontSize: 12, padding: '2px 4px' } as const
const hintStyle = { margin: 0, fontSize: 11, opacity: 0.7 } as const

/** 提供方卡片内的 DeepSeek 思考面板。 */
export function ProviderReasoningPanel({ provider, api }: PanelProps): ReactElement {
  const [baseline, setBaseline] = useState<ProviderReasoning>(emptyProviderReasoning)
  const [value, setValue] = useState<ProviderReasoning>(emptyProviderReasoning)
  const [revision, setRevision] = useState<number | undefined>(undefined)
  const [writable, setWritable] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [notice, setNotice] = useState<string | undefined>(undefined)

  /** 从 describe 结果里取出当前命名空间的面板事实；找不到时 undefined。 */
  const factsOf = (
    describe: SettingsDescribeValueLike,
  ): { current: ProviderReasoning; revision: number; writable: boolean } | undefined => {
    const view = describe.namespaces.find((candidate) => candidate.ns === provider.settingsNs)
    if (view === undefined) return undefined
    return {
      current: providerReasoningFrom(view.value),
      revision: view.revision,
      writable: describe.writable,
    }
  }

  const load = async (): Promise<void> => {
    // describe 走的是远程一元调用；载体故障 / 网络异常可能在 Promise 上 reject，
    // 不接住会变成未处理拒绝（React 侧只表现为面板一直空着）。
    try {
      const outcome = await api.describe()
      if (!outcome.ok) {
        setError(api.t('providerLoadFailed', { message: `${outcome.code}: ${outcome.message}` }))
        return
      }
      const facts = factsOf(outcome.value)
      if (facts === undefined) {
        setError(api.t('providerLoadFailed', { message: `namespace ${provider.settingsNs} is not registered` }))
        return
      }
      setBaseline(facts.current)
      setValue(facts.current)
      setRevision(facts.revision)
      setWritable(facts.writable)
      setError(undefined)
    } catch (cause) {
      setError(api.t('providerLoadFailed', { message: cause instanceof Error ? cause.message : String(cause) }))
    }
  }

  /**
   * 写入失败后刷新基线 / revision（保留用户当前选择的值）。
   *
   * 常见失败是 revision 已被别处改动（CAS 冲突）；不刷新的话下一次写入会继续拿
   * 旧 revision 撞冲突。刷新失败时保留旧基线，由用户重试。
   */
  const refreshFacts = async (): Promise<void> => {
    try {
      const outcome = await api.describe()
      if (!outcome.ok) return
      const facts = factsOf(outcome.value)
      if (facts === undefined) return
      setBaseline(facts.current)
      setRevision(facts.revision)
      setWritable(facts.writable)
    } catch {
      // 远程面不可用：保留旧基线，错误提示已由调用方展示。
    }
  }

  useEffect(() => {
    void load()
    return api.onSettingsChanged(provider.settingsNs, () => {
      void load()
    })
    // provider.settingsNs 由 owner props 固定；api 在 apply 生命周期内稳定。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, provider.settingsNs])

  const write = async (): Promise<void> => {
    const conflict = validateProviderReasoning(value)
    if (conflict !== undefined) {
      setError(api.t('providerConflict'))
      setNotice(undefined)
      return
    }
    const ops = providerReasoningOps(baseline, value)
    if (ops.length === 0) {
      setNotice(api.t('providerSaved'))
      setError(undefined)
      return
    }
    setBusy(true)
    setError(undefined)
    setNotice(undefined)
    try {
      const outcome = await api.mutate(provider.settingsNs, ops, revision)
      if (!outcome.ok) {
        setError(api.t('providerWriteFailed', { message: `${outcome.code}: ${outcome.message}` }))
        // 失败路径先把基线 / revision 对齐到 Host 的最新值，避免 revision 变脏后
        // 一直撞 CAS 冲突；用户选中的值保留，可再点一次「写入」。
        await refreshFacts()
        return
      }
      setBaseline(providerReasoningFrom(outcome.value.value))
      setRevision(outcome.value.revision)
      setNotice(api.t('providerSaved'))
    } catch (cause) {
      setError(api.t('providerWriteFailed', { message: cause instanceof Error ? cause.message : String(cause) }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 6, margin: '8px 0 0' }} data-dsh-mc-provider-reasoning="">
      <span style={{ fontSize: 12, fontWeight: 600 }}>{api.t('providerTitle')}</span>
      <p style={hintStyle}>{api.t('providerHint')}</p>
      <label style={fieldStyle}>
        <span>{api.t('providerThinking')}</span>
        <select
          style={selectStyle}
          value={value.thinking}
          disabled={!writable || busy}
          onChange={(event) => { setValue({ ...value, thinking: event.target.value as ProviderReasoning['thinking'] }) }}
        >
          <option value="">{api.t('providerDefault')}</option>
          <option value="enabled">{api.t('providerEnabled')}</option>
          <option value="disabled">{api.t('providerDisabled')}</option>
        </select>
      </label>
      <label style={fieldStyle}>
        <span>{api.t('providerEffort')}</span>
        <select
          style={selectStyle}
          value={value.effort}
          disabled={!writable || busy}
          onChange={(event) => { setValue({ ...value, effort: event.target.value as ProviderReasoning['effort'] }) }}
        >
          <option value="">{api.t('providerDefault')}</option>
          <option value="off">off</option>
          <option value="low">low</option>
          <option value="high">high</option>
          <option value="max">max</option>
        </select>
      </label>
      <div style={rowStyle}>
        <button type="button" disabled={!writable || busy} onClick={() => { void write() }}>
          {api.t('providerWrite')}
        </button>
        {error !== undefined ? <span style={{ color: 'var(--dsw-alias-state-error, #c33)', fontSize: 11 }}>{error}</span> : null}
        {notice !== undefined ? <span style={{ fontSize: 11, opacity: 0.8 }}>{notice}</span> : null}
        {!writable && error === undefined ? <span style={hintStyle}>{api.t('readOnly')}</span> : null}
      </div>
    </div>
  )
}
