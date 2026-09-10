/**
 * `settings.models.provider-card` 的 llm-pi-ai 席位组件。
 *
 * 官方模型行内部没有 Slot，所以这里只渲染一个**隐藏锚点**；真正的行内控件由
 * `augment.ts` 在锚点所在的提供方卡片里观察 DOM 后注入到模型行的「容量」展开区。
 * 组件本身不显示任何可见 UI，也不接触 ctx（Host 操作通过 `api` 传入）。
 */
import { useEffect, useRef } from 'react'
import type { ReactElement } from 'react'
import { augment } from './augment.js'
import type { PanelProps } from './types.js'

/** 席位组件。 */
export function ModelCapabilitiesAnchor(props: PanelProps): ReactElement | null {
  const { provider, configured, api } = props
  const anchorRef = useRef<HTMLSpanElement | null>(null)
  const pathKey = provider.settingsPath.join('.')

  useEffect(() => {
    if (!configured) return undefined
    const anchor = anchorRef.current
    if (anchor === null) return undefined
    const handle = augment({
      anchor,
      settingsNs: provider.settingsNs,
      settingsPath: provider.settingsPath,
      declared: provider.declared,
      api,
    })
    return () => {
      handle.dispose()
    }
    // pathKey 覆盖 settingsPath 的内容；数组本身每次渲染都是新引用。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, configured, pathKey, provider.declared, provider.settingsNs])

  if (!configured) return null
  return <span ref={anchorRef} hidden data-dsh-mc-anchor="" />
}
