/**
 * dsh-tweaks-model-capabilities — 浏览器半区入口。
 *
 * 向 `settings.models.provider-card`（keyed，entryKey = settingsNs）注册
 * `llm-pi-ai` 的席位。席位本身只渲染隐藏锚点：官方模型行内部没有 Slot，行内的
 * 「思考强度 / 多模态 / 1M·128K」控件由 `augment.ts` 注入到模型行的「容量」展开区，
 * 改完点官方「保存」后写入 `llm-pi-ai` 分节。
 *
 * 依赖与生命周期：
 * - 服务通过 cordis 的 `inject` 声明后从 ctx 取。**`remote.settings` 必须声明**：
 *   `ctx.remote` 的子命名空间是 cordis Guard 代理，读 `ctx.remote.settings` 会
 *   被翻译成查询 `remote.settings` 服务，未声明会直接抛
 *   `cannot get property "remote.settings" without inject`；
 * - `slots.inject` 等待席位声明后注册，返回的 disposer 由注入回调原样交还；
 * - locale 用三参非类型化形态注册 zh/en（本插件无法 import 官方
 *   `LocaleNamespaceMap`，也不该为类型依赖官方包）。
 */
import { createElement } from 'react'
import { ModelCapabilitiesAnchor } from './anchor.js'
import { en, LOCALE_NS, zh } from './locales.js'
import type {
  CapabilityApi,
  LocaleLike,
  PluginClientContextLike,
  ProviderCardOwnerPropsLike,
  RemoteLike,
  RemoteOutcome,
  SettingsDescribeValueLike,
  SettingsNamespaceViewLike,
  SettingsRemoteLike,
  SlotsServiceLike,
} from './types.js'
import type { SettingsPathOp } from './capability.js'

/** 本插件在 `settings.models.provider-card` 上占用的 key（= 适配器的 settingsNs）。 */
export const PROVIDER_CARD_KEYS = ['llm-pi-ai', 'llm-deepseek'] as const

/** 硬依赖：席位、文案、Host 远程面与 settings 子命名空间；由 cordis 注入并在就绪后激活。 */
export const inject = ['slots', 'locale', 'remote', 'remote.settings']

/** 把一个可能返回 disposer 的调用结果收成可调用 disposer。 */
function asDisposer(value: unknown): () => void {
  return typeof value === 'function' ? (value as () => void) : () => undefined
}

/** 把 RemoteResult 的失败分支折成统一 outcome。 */
function failureOf<T>(error: { code?: string; message?: string } | undefined, fallback: string): RemoteOutcome<T> {
  return {
    ok: false,
    code: error?.code ?? 'unknown',
    message: error?.message ?? fallback,
  }
}

/** 绑定 Host 操作与文案。 */
function createCapabilityApi(ctx: PluginClientContextLike, t: CapabilityApi['t']): CapabilityApi {
  const getRemote = (): RemoteLike | undefined => ctx.get('remote') as RemoteLike | undefined
  const getSettings = (): SettingsRemoteLike | undefined =>
    (ctx.get('remote.settings') as SettingsRemoteLike | undefined) ?? getRemote()?.settings

  return {
    async describe(): Promise<RemoteOutcome<SettingsDescribeValueLike>> {
      const settings = getSettings()
      if (settings === undefined) {
        return { ok: false, code: 'remote-unavailable', message: 'ctx.remote.settings is not mounted' }
      }
      const result = await settings.describe()
      if (result.ok) return { ok: true, value: result.value }
      return failureOf<SettingsDescribeValueLike>(result.error, 'settings describe failed')
    },
    async mutate(
      ns: string,
      ops: readonly SettingsPathOp[],
      expectedRevision: number | undefined,
    ): Promise<RemoteOutcome<SettingsNamespaceViewLike>> {
      const settings = getSettings()
      if (settings === undefined) {
        return { ok: false, code: 'remote-unavailable', message: 'ctx.remote.settings is not mounted' }
      }
      const result = await settings.mutate(ns, ops, expectedRevision)
      if (result.ok) return { ok: true, value: result.value }
      return failureOf<SettingsNamespaceViewLike>(result.error, 'settings mutate failed')
    },
    onSettingsChanged(ns: string, listener: (revision: number | undefined) => void): () => void {
      const remote = getRemote()
      if (remote?.$on === undefined) return () => undefined
      return remote.$on('settings/document-updated', (...args: unknown[]) => {
        if (args[0] !== ns) return
        listener(typeof args[1] === 'number' ? args[1] : undefined)
      })
    },
    t,
  }
}

/**
 * 客户端插件体。
 * @param ctx - 客户端根上下文。
 */
export function apply(ctx: PluginClientContextLike): void {
  const slots = ctx.get('slots') as SlotsServiceLike | undefined
  if (slots === undefined) return

  const locale = ctx.get('locale') as LocaleLike | undefined
  const bound = locale?.bind(LOCALE_NS)
  const t: CapabilityApi['t'] = bound ?? ((key: string) => key)

  if (locale !== undefined) {
    const register = (): (() => void) => {
      const disposers: (() => void)[] = []
      try {
        disposers.push(asDisposer(locale.register(LOCALE_NS, 'zh', zh)))
        disposers.push(asDisposer(locale.register(LOCALE_NS, 'en', en)))
      } catch {
        // 同一页面重复 apply（HMR）时命名空间已被占用：保留既有字典即可。
      }
      return () => {
        for (const dispose of disposers) dispose()
      }
    }
    if (typeof ctx.effect === 'function') ctx.effect(register)
    else register()
  }

  const api = createCapabilityApi(ctx, t)

  // 同一份实现挂两个 key：llm-pi-ai（思考强度 + 多模态）与 llm-deepseek
  // （只有多模态，DeepSeek 适配器没有每模型思考强度）。
  for (const key of PROVIDER_CARD_KEYS) {
    slots.inject('settings.models.provider-card', () =>
      slots.register({ name: 'settings.models.provider-card', key }, (props) =>
        createElement(ModelCapabilitiesAnchor, { ...(props as ProviderCardOwnerPropsLike), api }),
      ),
    )
  }
}
