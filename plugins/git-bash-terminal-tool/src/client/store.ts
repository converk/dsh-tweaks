/**
 * 设置行的状态源：`settingsScope`（持久化）+ 宿主 `/api`（平台、能力探测、扫描）。
 *
 * 一切都是手写的小 store（`getState` / `subscribe`），供 `row.tsx` 用
 * `useSyncExternalStore` 订阅 —— React 18 的官方 API，不需要额外依赖。
 *
 * 需求映射（这一版的关键约束）：
 * - **插件绝不自动切换工具**：`dialect` 只有在用户点 chip 时才会被写；
 *   默认值来自 host schema 的 `pwsh`。挂载时不做任何扫描、不写任何设置。
 * - **自动发现是用户行为**：`discover()` 只在点「自动发现」时调用 `/discover`，
 *   并把「选中的路径 + 这批可用路径」一次性持久化。
 * - **`/state` 不扫描**（宿主侧已改），所以设置项打开是瞬时的。
 */
import { fetchCandidates, fetchState } from './api.js'
import type { CandidateView, Dialect, StateView } from '../shared/protocol.js'
import type { SettingsScopeLike } from './types.js'

/** 本插件的设置值形状（与 host 的 `TerminalToolSettings` 一致）。 */
export interface TerminalToolSettingsValue {
  readonly dialect: Dialect
  readonly bashPath: string
  /** 上一次「自动发现」扫到的可用路径（持久化，服务下拉列表）。 */
  readonly bashCandidates: readonly string[]
}

/** 行状态。 */
export interface RowState {
  /** `loading` / `hidden` 时渲染 null（避免先闪一下再隐藏）。 */
  readonly status: 'loading' | 'hidden' | 'ready'
  /** `process.platform`。 */
  readonly platform: string
  /** 当前方言（settingsScope 为准，未就绪时用 host 的快照）。 */
  readonly dialect: Dialect
  /** 当前 bashPath。 */
  readonly bashPath: string
  /** 持久化的候选路径（来自 settings 的 `bashCandidates`）。 */
  readonly savedCandidates: readonly string[]
  /** 本次会话里「自动发现」扫到的可用路径（仅内存）。 */
  readonly scanned: readonly string[]
  /** settingsScope 是否可写（memory 模式或未就绪时不可写）。 */
  readonly writable: boolean
  /** 宿主半区是否挂上（namespace 是否登记）。 */
  readonly namespaceRegistered: boolean
  /** capability：不支持时的原因。 */
  readonly supported: boolean
  readonly unsupportedReason?: string | undefined
  /** 宿主 advertise 的沙箱模式（undefined = 不 confine）。 */
  readonly shellSandboxMode?: string | undefined
  /** 正在扫描。 */
  readonly discovering: boolean
  /** 正在保存。 */
  readonly saving: boolean
  /** 最近一次错误（保存失败 / 取数失败）。 */
  readonly error?: string | undefined
  /** 提示文案（扫描没找到东西时的说明）。 */
  readonly notice?: string | undefined
}

/** 一个极简的可订阅 store。 */
export interface Store<T> {
  getState(): T
  subscribe(listener: () => void): () => void
  setState(patch: Partial<T>): void
}

/** 创建最小 store（状态没变就保持同一个对象引用）。 */
export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    setState: (patch) => {
      const next = { ...state, ...patch }
      if (shallowEqual(state, next)) return
      state = next
      for (const listener of [...listeners]) listener()
    },
  }
}

/** 浅比较（避免无意义的重渲染）。 */
function shallowEqual(a: object, b: object): boolean {
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  for (const key of keys) if (left[key] !== right[key]) return false
  return true
}

/** 初始状态。 */
export const INITIAL_ROW_STATE: RowState = {
  status: 'loading',
  platform: '',
  dialect: 'pwsh',
  bashPath: '',
  savedCandidates: [],
  scanned: [],
  writable: false,
  namespaceRegistered: false,
  supported: false,
  discovering: false,
  saving: false,
}

/** 路径去重键（Windows 语义：分隔符统一、大小写不敏感）。 */
function pathKey(path: string): string {
  return path.trim().replace(/\//g, '\\').toLowerCase()
}

/**
 * 两个路径是否指向同一个文件（Windows 语义）。
 * @param a - 路径一。
 * @param b - 路径二。
 * @returns 是否同一个路径。
 */
export function samePath(a: string, b: string): boolean {
  return pathKey(a) === pathKey(b)
}

/**
 * 已知的 Git Bash 路径（下拉列表的来源）。
 *
 * 顺序：当前值 → 本次扫描结果 → 持久化的候选；按 Windows 路径语义去重。
 * @param state - 行状态。
 * @returns 去重后的路径列表。
 */
export function knownPaths(state: RowState): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const push = (path: string): void => {
    const value = path.trim()
    if (value.length === 0) return
    const key = pathKey(value)
    if (seen.has(key)) return
    seen.add(key)
    out.push(value)
  }
  push(state.bashPath)
  for (const path of state.scanned) push(path)
  for (const path of state.savedCandidates) push(path)
  return out
}

/** 行的控制器。 */
export interface RowController {
  readonly store: Store<RowState>
  /** 首次加载：读 settingsScope + 宿主状态；返回卸载函数。 */
  start(): () => void
  /** 切换方言（写设置；路径不在这里挑）。 */
  setDialect(dialect: Dialect): void
  /** 写入 bashPath。 */
  setBashPath(path: string): void
  /** 用户点「自动发现」：扫描 → 选中第一个可用候选 → 持久化。 */
  discover(): void
}

/** 错误压成一行。 */
function messageOf(error: unknown): string {
  return error instanceof Error && error.message.length > 0 ? error.message : String(error)
}

/**
 * 创建控制器。
 * @param scope - `settingsScope.bind({ namespace: 'terminal-tool' })` 的结果（可为 undefined）。
 * @param translate - 文案函数。
 * @returns 控制器。
 */
export function createRowController(
  scope: SettingsScopeLike<TerminalToolSettingsValue> | undefined,
  translate: (key: string, params?: Record<string, string>) => string,
): RowController {
  const store = createStore<RowState>(INITIAL_ROW_STATE)
  const disposers: (() => void)[] = []
  /** settingsScope 是否已经给出过一个可用值（给出后就以它为准，不再用 host 快照覆盖）。 */
  let settingsReady = false

  const syncSettings = (): void => {
    if (scope === undefined) return
    const snapshot = scope.getSnapshot()
    const value = snapshot.value
    if (value !== undefined) settingsReady = true
    store.setState({
      writable: snapshot.writable && snapshot.mode === 'host' && snapshot.status === 'ready',
      ...(value !== undefined
        ? { dialect: value.dialect, bashPath: value.bashPath, savedCandidates: value.bashCandidates }
        : {}),
    })
  }

  const start = (): (() => void) => {
    let active = true
    if (scope !== undefined) {
      syncSettings()
      disposers.push(
        scope.subscribe(() => {
          if (active) syncSettings()
        }),
      )
    }
    fetchState()
      .then((state: StateView) => {
        if (!active) return
        store.setState({
          platform: state.platform,
          namespaceRegistered: state.namespaceRegistered,
          supported: state.capability.supported,
          ...(state.capability.reason !== undefined ? { unsupportedReason: state.capability.reason } : {}),
          ...(state.capability.shellSandboxMode !== undefined ? { shellSandboxMode: state.capability.shellSandboxMode } : {}),
          // host 快照只用于 settings 还没就绪时的兜底渲染，绝不覆盖用户刚做的选择。
          ...(settingsReady ? {} : { dialect: state.dialect, bashPath: state.bashPath }),
          status: state.platform === 'win32' ? 'ready' : 'hidden',
        })
      })
      .catch((error: unknown) => {
        if (!active) return
        const platform = store.getState().platform
        store.setState({
          status: platform.length === 0 ? 'loading' : platform === 'win32' ? 'ready' : 'hidden',
          error: messageOf(error),
        })
      })
    return () => {
      active = false
      for (const dispose of disposers) dispose()
      disposers.length = 0
    }
  }

  /** 写设置（没有 scope 时只报错，不静默）。 */
  const write = (ops: readonly { op: 'set'; path: readonly string[]; value: unknown }[]): void => {
    if (scope === undefined) {
      store.setState({ saving: false, error: translate('row.unavailable') })
      return
    }
    store.setState({ saving: true })
    scope
      .mutate(ops)
      .then(() => {
        store.setState({ saving: false, error: undefined })
      })
      .catch((error: unknown) => {
        store.setState({ saving: false, error: translate('row.saveFailed', { message: messageOf(error) }) })
      })
  }

  /** 只改方言；`bashPath` 由用户自己用「自动发现」或路径栏决定（插件不替他挑）。 */
  const setDialect = (dialect: Dialect): void => {
    store.setState({ dialect, error: undefined, notice: undefined })
    write([{ op: 'set', path: ['dialect'], value: dialect }])
  }

  const setBashPath = (path: string): void => {
    store.setState({ bashPath: path, error: undefined, notice: undefined })
    write([{ op: 'set', path: ['bashPath'], value: path }])
  }

  const discover = (): void => {
    const current = store.getState().bashPath
    store.setState({ discovering: true, error: undefined, notice: undefined })
    fetchCandidates(current)
      .then((view) => {
        const usable: string[] = []
        for (const candidate of view.candidates) {
          if (candidate.valid && !usable.some((path) => samePath(path, candidate.path))) usable.push(candidate.path)
        }
        if (usable.length === 0) {
          store.setState({ discovering: false, scanned: [], notice: translate('row.foundNone') })
          return
        }
        // 已有的可用路径保持不动（不静默改写用户的选择）；它不可用才换成第一个发现的。
        const picked = current.trim().length > 0 && usable.some((path) => samePath(path, current)) ? current : usable[0]!
        store.setState({ discovering: false, scanned: usable, bashPath: picked, notice: undefined })
        write([
          { op: 'set', path: ['bashPath'], value: picked },
          { op: 'set', path: ['bashCandidates'], value: usable },
        ])
      })
      .catch((error: unknown) => {
        store.setState({ discovering: false, error: messageOf(error) })
      })
  }

  return { store, start, setDialect, setBashPath, discover }
}

/** 行组件需要的候选视图类型（重新导出，避免组件直接依赖 protocol）。 */
export type { CandidateView }
