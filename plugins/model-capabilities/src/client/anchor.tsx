/**
 * `settings.models.provider-card` 的 llm-pi-ai 席位组件。
 *
 * 官方模型行内部没有 Slot，所以这里只渲染一个**隐藏锚点**；真正的行内控件由
 * `augment.ts` 在锚点所在的提供方卡片里观察 DOM 后注入到模型行的「容量」展开区。
 * 组件本身不显示任何可见 UI，也不接触 ctx（Host 操作通过 `api` 传入）。
 */
import { useEffect, useRef } from 'react'
import type { ReactElement, RefObject } from 'react'
import { augment } from './augment.js'
import { ProviderReasoningPanel } from './provider-panel.js'
import type { PanelProps } from './types.js'

/** 席位组件。 */
export function ModelCapabilitiesAnchor(props: PanelProps): ReactElement | null {
  const { provider, configured, api } = props
  const anchorRef = useRef<HTMLDivElement | HTMLSpanElement | null>(null)
  const pathKey = provider.settingsPath.join('.')

  useEffect(() => {
    if (!configured) return undefined
    const anchor = anchorRef.current
    if (anchor === null) return undefined
    const handle = augment({
      anchor,
      settingsNs: provider.settingsNs,
      settingsPath: provider.settingsPath,
      api,
    })
    return () => {
      handle.dispose()
    }
    // pathKey 覆盖 settingsPath 的内容；数组本身每次渲染都是新引用。
    // 思考强度的归属由 augment.ts 按行运行期探测，不依赖 provider.declared。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, configured, pathKey, provider.settingsNs])

  if (!configured) return null
  // DeepSeek 的官方卡片没有暴露提供方级 thinking / reasoningEffort
  // （account 路由甚至连模型行都没有），所以面板直接可见；行内容量/摘要仍由 augment 负责。
  if (provider.settingsNs === 'llm-deepseek' || provider.settingsNs === 'llm-deepseek-account') {
    return (
      <div ref={anchorRef as RefObject<HTMLDivElement>} data-dsh-mc-anchor="">
        <ProviderReasoningPanel provider={provider} configured={configured} keyConfigured={props.keyConfigured} api={api} />
      </div>
    )
  }
  return <span ref={anchorRef as RefObject<HTMLSpanElement>} hidden data-dsh-mc-anchor="" />
}
