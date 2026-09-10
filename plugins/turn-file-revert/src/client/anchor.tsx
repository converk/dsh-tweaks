/**
 * 隐藏锚点：本插件在 `conversation.input.overlay` 上的常驻条目。
 *
 * 它自己不画任何东西（一个 0 尺寸的 span），唯一职责是拿到**会话作用域的标准
 * props**（`sessionId`），并在挂载期间安装 / 卸载 `augment` 的 DOM 增补层——
 * 官方的回合尾部没有可用的扩展席位，所以真正的界面是增补出来的。
 */
import { useEffect, useRef } from 'react'
import { augment } from './augment.js'
import type { Translate, TurnRevertApi } from './types.js'

/** 锚点组件收到的 props（标准 props + 插件自己注入的两个）。 */
export interface TurnRevertAnchorProps {
  /** 当前会话 id（session 作用域 Slot 的标准 props）。 */
  readonly sessionId?: string | undefined
  /** 宿主 RPC 门面，由插件 apply 注入。 */
  readonly api: TurnRevertApi
  /** 文案，由插件 apply 注入。 */
  readonly t: Translate
}

/**
 * 常驻锚点组件。
 * @param props - 见 {@link TurnRevertAnchorProps}。
 * @returns 一个隐藏的 span。
 */
export function TurnRevertAnchor(props: TurnRevertAnchorProps): JSX.Element {
  const { sessionId, api, t } = props
  const ref = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    if (typeof sessionId !== 'string' || sessionId.length === 0) return undefined
    const handle = augment({ sessionId, api, t })
    return () => {
      handle.dispose()
    }
  }, [sessionId, api, t])

  return <span ref={ref} data-dsh-tfr="anchor" hidden />
}
