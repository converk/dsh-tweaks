/**
 * dsh-tweaks-git-bash-terminal-tool —— 浏览器半区入口。
 *
 * 只做一件事：往 `settings.general.item`（设置→通用 里「一个紧凑的通用偏好项」的
 * 列表席位，Language / Appearance / Composer Enter 都在这里）注册一行「终端工具」。
 *
 * ⚠️ client bundle 的入口插件**必须**声明 `inject`（AGENTS.md §2.2）：没有它插件会
 * 立刻激活，此时 `slots` / `settingsScope` 可能还没被提供，结果是**静默什么都不注册**。
 */
import { createElement } from 'react'
import { en, LOCALE_NS, zh } from './locales.js'
import { TerminalToolRow } from './row.js'
import { SETTINGS_NAMESPACE } from '../shared/protocol.js'
import type { TerminalToolSettingsValue } from './store.js'
import type {
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
 * 硬依赖：席位、文案、设置通道。
 *
 * `settingsScope` 是本插件**唯一**的设置读写通道（读走官方的 describe 镜像、
 * 写走官方 remote，host 的 `validate` 在写入时把关）。
 */
export const inject = ['slots', 'locale', 'settingsScope']

/**
 * 把 wire section 窄化成行需要的值（`SettingsScopeSpec.decode`）。
 *
 * 为什么要显式给 decoder：缺省时客户端会用 host 那份**手写 wire schema**
 * （`schema.toJSON()` → `new Schema(json)` → 校验）来判定 section 是否可用；
 * 那份 schema 一旦与 schemastery 的约定有出入，快照就会永远卡在 `loading`，
 * 表现是「设置行两个选项全都点不动，却没有任何报错」。
 * 这里自己解码，读值只依赖 host 真正存了什么。
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

  // 设置通道在注册时刻绑定到本插件的 ctx 上（服务代理会把注册记到调用方 fiber）。
  const binder = ctx.get('settingsScope') as SettingsScopeBinderLike | undefined
  let scope: SettingsScopeLike<TerminalToolSettingsValue> | undefined
  if (binder !== undefined && binder !== null && typeof binder.bind === 'function') {
    try {
      scope = binder.bind<TerminalToolSettingsValue>({ namespace: SETTINGS_NAMESPACE, decode: decodeSettings })
    } catch {
      scope = undefined
    }
  }

  slots.inject('settings.general.item', () =>
    slots.register({ name: 'settings.general.item', id: GENERAL_ITEM_ID, order: GENERAL_ITEM_ORDER, locale: LOCALE_NS }, () =>
      createElement(TerminalToolRow, { t, scope }),
    ),
  )
}
