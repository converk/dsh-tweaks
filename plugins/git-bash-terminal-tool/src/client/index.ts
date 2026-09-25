/**
 * dsh-tweaks-git-bash-terminal-tool —— 浏览器半区入口。
 *
 * 只做一件事：往 `settings.general.item`（设置→通用 里「一个紧凑的通用偏好项」的
 * 列表席位，Language / Appearance / Composer Enter 都在这里）注册一行「终端工具」。
 *
 * ⚠️ client bundle 的入口插件**必须**声明 `inject`（AGENTS.md §2.2）：没有它插件会
 * 立刻激活，此时 `slots` 可能还没被提供，结果是**静默什么都不注册**。
 */
import { createElement } from 'react'
import { en, LOCALE_NS, zh } from './locales.js'
import { TerminalToolRow } from './row.js'
import { SETTINGS_NAMESPACE } from '../shared/protocol.js'
import type { TerminalToolSettingsValue } from './store.js'
import type {
  ConfigFormsLike,
  LocaleLike,
  PluginClientContextLike,
  SettingsScopeBinderLike,
  SettingsScopeLike,
  SlotsServiceLike,
  Translate,
} from './types.js'

/** 本插件在 General 列表里的条目 id。 */
export const GENERAL_ITEM_ID = 'terminal-tool'

/** 行在 General 里的顺序（官方已用 0/10/20 等小值，这里排到后面）。 */
export const GENERAL_ITEM_ORDER = 60

/**
 * 硬依赖：席位、文案。
 *
 * 设置通道**不进 `inject`**：0.1.7 起官方客户端不再提供 `settingsScope`，声明成硬依赖
 * 会让整个条目永远 `pending`（启动横幅「Failed to load plugins：waiting for service
 * settingsScope」）。实际有三条路，全部用 `ctx.get` 判空取：
 * 1. `webUiSettings`（家族兼容层 `@linxin666/dsh-client-ui-web-ui-settings`，契约与旧
 *    `settingsScope` 相同，按 namespace bind）；
 * 2. `settingsScope`（0.1.5 旧官方通道）；
 * 3. `configForms`（0.1.7 官方原生表单，`get(entryId)` 直接返回同形表单）——
 *    没有家族兼容层的普通 0.1.7 部署靠它。
 */
export const inject = ['slots', 'locale']

/**
 * 把 wire section 窄化成行需要的值（`SettingsScopeSpec.decode`）。
 *
 * 为什么要显式给 decoder：缺省时客户端会用 entry Config 的 wire schema
 * （`schema.toJSON()` → `new Schema(json)` → 校验）判定 section 是否可用；
 * 这里自己解码，读值只依赖 host 真正存了什么，不受表单 schema 投影的影响。
 *
 * ⚠️ 绑定的 namespace 是 **profile entry id**（`git-bash-terminal-tool`，见
 * `shared/protocol.ts`）：0.1.7 的设置面按 entry id 定位表单，只有 namespace 命中
 * 一个已服务 entry id 时 `webUiSettings` 才会提升到原生共享表单。
 * @param section - describe 返回的 namespace section。
 * @returns 行需要的值；结构完全不可用时 undefined（保留上一个可用值）。
 */
export function decodeSettings(section: unknown): TerminalToolSettingsValue | undefined {
  if (typeof section !== 'object' || section === null || Array.isArray(section)) return undefined
  const record = section as Record<string, unknown>
  const dialect = record.dialect === 'bash' ? 'bash' : 'pwsh'
  const bashPath = typeof record.bashPath === 'string' ? record.bashPath : ''
  const bashCandidates = Array.isArray(record.bashCandidates)
    ? record.bashCandidates.filter((path): path is string => typeof path === 'string')
    : []
  return { dialect, bashPath, bashCandidates }
}

/** 把一个可能返回 disposer 的调用结果收成可调用 disposer。 */
function asDisposer(value: unknown): () => void {
  return typeof value === 'function' ? (value as () => void) : () => undefined
}

/**
 * 客户端插件体。
 * @param ctx - 客户端根上下文。
 */
export function apply(ctx: PluginClientContextLike): void {
  const locale = ctx.get('locale') as LocaleLike | undefined
  if (locale !== undefined && locale !== null) {
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
    if (typeof ctx.effect === 'function') ctx.effect(register, 'git-bash-terminal-tool: dictionaries')
    else register()
  }

  const bound = locale?.bind(LOCALE_NS)
  const t: Translate = bound ?? ((key: string) => key)

  const slots = ctx.get('slots') as SlotsServiceLike | undefined
  if (slots === undefined || slots === null) return

  /**
   * 家族兼容层（`webUiSettings`）/ 旧官方通道（`settingsScope`）：按 namespace 绑定。
   * 两者都用 `ctx.get` 判空 —— 见 `inject` 的注释。
   */
  const findBinder = (): SettingsScopeBinderLike | undefined => {
    const binder = (ctx.get('webUiSettings') ?? ctx.get('settingsScope')) as SettingsScopeBinderLike | undefined
    return binder !== undefined && binder !== null && typeof binder.bind === 'function' ? binder : undefined
  }

  /**
   * 官方 0.1.7 原生表单（`dsh-client-ui-settings` 的 `configForms`）：
   * `get(entryId)` 直接返回与 `SettingsScopeLike` 同形的表单 —— 不需要 bind。
   */
  const findNativeForm = (): SettingsScopeLike<TerminalToolSettingsValue> | undefined => {
    const forms = ctx.get('configForms') as ConfigFormsLike | undefined
    if (forms === undefined || forms === null || typeof forms.get !== 'function') return undefined
    try {
      return forms.get<TerminalToolSettingsValue>(SETTINGS_NAMESPACE)
    } catch {
      return undefined
    }
  }

  /** 绑定一个 binder；失败时返回 undefined（行照常登记，只是控件不可写）。 */
  const bindScope = (binder: SettingsScopeBinderLike): SettingsScopeLike<TerminalToolSettingsValue> | undefined => {
    try {
      return binder.bind<TerminalToolSettingsValue>({ namespace: SETTINGS_NAMESPACE, decode: decodeSettings })
    } catch {
      return undefined
    }
  }

  let seated = false
  /**
   * 把设置行登记到 General 列表席位（最多登记一次）。
   * @param scope - 设置表单；undefined 时行仍登记，控件显示为不可用。
   */
  const seatRow = (scope: SettingsScopeLike<TerminalToolSettingsValue> | undefined): void => {
    if (seated) return
    seated = true
    slots.inject('settings.general.item', () =>
      slots.register({ name: 'settings.general.item', id: GENERAL_ITEM_ID, order: GENERAL_ITEM_ORDER, locale: LOCALE_NS }, () =>
        createElement(TerminalToolRow, { t, scope }),
      ),
    )
  }

  /** 依次尝试：家族兼容层 binder（可 bind）→ 官方原生表单。 */
  const resolveScope = (): { scope?: SettingsScopeLike<TerminalToolSettingsValue>; found: boolean } => {
    const binder = findBinder()
    if (binder !== undefined) {
      const scope = bindScope(binder)
      return scope !== undefined ? { scope, found: true } : { scope: findNativeForm(), found: true }
    }
    const native = findNativeForm()
    return native !== undefined ? { scope: native, found: true } : { found: false }
  }

  const first = resolveScope()
  if (first.found) {
    seatRow(first.scope)
  } else if (typeof ctx.inject === 'function') {
    // 设置通道通常晚于本插件激活：家族兼容层要等自己的 connection / remote 就位才会
    // 提供 `webUiSettings`，官方 `configForms` 由设置域插件提供。等任一个出现再补登记。
    // ⚠️ 两个服务都**不进** `inject` 数组：旧宿主没有 `webUiSettings`，硬依赖会让条目永远 pending。
    ctx.inject(['webUiSettings'], () => {
      if (seated) return
      const late = findBinder()
      if (late !== undefined) seatRow(bindScope(late))
    })
    ctx.inject(['configForms'], () => {
      if (seated) return
      const late = findNativeForm()
      if (late !== undefined) seatRow(late)
    })
  }
}
