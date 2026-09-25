/**
 * 「设置 → 通用 → 终端工具」这一行（`settings.general.item`）。
 *
 * 形态：
 *
 * ```
 * 终端工具
 * [PowerShell（pwsh）] [Git Bash（bash）]          ← 默认只显示这两个
 *    ↓ 用户点了 Git Bash 之后才出现：
 * Git Bash 路径  [ D:\env\msys2\usr\bin\bash.exe ] [自动发现]
 *   （多条已知路径时，路径栏变成下拉列表；路径栏只在 bash 方言下存在）
 * ```
 *
 * 关键约束：
 * - **仅 Windows 渲染**：bundle 自带的 patch 已经把整行 `disabled` 在非 win32 上，
 *   这里再兜一道（`status !== 'ready'` 时不渲染，避免先闪一下再隐藏）。
 * - **只有一个 chip 是选中的**；两个 chip 都**可点**（不再因为"还没发现过路径"而置灰）——
 *   「插件替用户选工具」这件事只发生在首次安装时的默认值（pwsh），其余全部由用户发起。
 * - **不展示候选清单**：路径栏本身就是选择器（>1 条时下拉），不需要把扫描细节摊在设置页里。
 * - 该槽位的 owner props 是**空的**（没有 label、没有 props），所以文案、当前值、
 *   写路径全部由本组件自己负责（见 slots.d.ts 的 `SettingsGeneralItemOwnerProps`）。
 */
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { createRowController, knownPaths, type RowController, type RowState } from './store.js'
import { injectStyles } from './styles.js'
import type { Dialect } from '../shared/protocol.js'
import type { SettingsScopeLike, Translate } from './types.js'

/** 路径栏控件的 id（label 的 `htmlFor` 用）。 */
const PATH_CONTROL_ID = 'dsh-git-bash-terminal-tool-path'

/** 组件的 props（该槽位不注入任何业务 props，只由 apply 传文案与 scope）。 */
export interface TerminalToolRowProps {
  readonly t: Translate
  readonly scope?: SettingsScopeLike<{ dialect: Dialect; bashPath: string; bashCandidates: readonly string[] }> | undefined
}

/** 订阅一个 store 的 hook（React 18 的 `useSyncExternalStore`）。 */
function useStoreState(controller: RowController): RowState {
  return useSyncExternalStore(
    useCallback((listener: () => void) => controller.store.subscribe(listener), [controller]),
    useCallback(() => controller.store.getState(), [controller]),
  )
}

/**
 * 渲染「终端工具」首选项行。
 * @param props - 文案与设置表单 scope（由 `apply` 注入）。
 * @returns 行元素树；非 Windows 或未加载完成时为 null。
 */
export function TerminalToolRow({ t, scope }: TerminalToolRowProps): JSX.Element | null {
  const controller = useMemo(() => createRowController(scope, t), [scope, t])
  const state = useStoreState(controller)
  const started = useRef(false)
  useEffect(() => {
    injectStyles()
  }, [])
  useEffect(() => {
    if (started.current) return
    started.current = true
    return controller.start()
  }, [controller])

  const onDiscover = useCallback(() => controller.discover(), [controller])

  if (state.status !== 'ready') return null

  const paths = knownPaths(state)
  const controlsEnabled = state.writable && state.supported && !state.saving
  const bashPath = state.bashPath.trim()

  return (
    <div className="tterm-group" data-dsh-git-bash-terminal-tool="row">
      <div className="tterm-title">{t('row.title')}</div>
      <div className="tterm-row">
        <button
          type="button"
          className={`tterm-chip${state.dialect === 'pwsh' ? ' tterm-chip-on' : ''}`}
          aria-pressed={state.dialect === 'pwsh'}
          disabled={!controlsEnabled}
          onClick={() => controller.setDialect('pwsh')}
        >
          {t('row.dialect.pwsh')}
        </button>
        <button
          type="button"
          className={`tterm-chip${state.dialect === 'bash' ? ' tterm-chip-on' : ''}`}
          aria-pressed={state.dialect === 'bash'}
          disabled={!controlsEnabled}
          onClick={() => controller.setDialect('bash')}
        >
          {t('row.dialect.bash')}
        </button>
      </div>
      {state.dialect === 'bash' ? (
        <div className="tterm-row">
          <label className="tterm-note" htmlFor={PATH_CONTROL_ID}>
            {t('row.path.label')}
          </label>
          {paths.length > 1 ? (
            <select
              id={PATH_CONTROL_ID}
              className="tterm-input"
              value={state.bashPath}
              disabled={!controlsEnabled}
              onChange={(event) => controller.setBashPath(event.target.value)}
            >
              {bashPath.length === 0 ? <option value="">{t('row.path.none')}</option> : null}
              {paths.map((path) => (
                <option key={path} value={path}>
                  {path}
                </option>
              ))}
            </select>
          ) : (
            <input
              // key 绑定当前值：外部改值（自动发现 / 下拉）后重挂载，输入框跟着刷新；
              // 打字过程中值不变，所以不会打断输入。
              key={state.bashPath}
              id={PATH_CONTROL_ID}
              className="tterm-input"
              type="text"
              spellCheck={false}
              placeholder={t('row.path.placeholder')}
              defaultValue={state.bashPath}
              disabled={!controlsEnabled}
              onBlur={(event) => {
                const next = event.currentTarget.value.trim()
                if (next !== bashPath) controller.setBashPath(next)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
              }}
            />
          )}
          <button type="button" className="tterm-button" disabled={!controlsEnabled || state.discovering} onClick={onDiscover}>
            {state.discovering ? t('row.discovering') : t('row.discover')}
          </button>
        </div>
      ) : null}
      {state.dialect === 'bash' && bashPath.length === 0 ? (
        <div className="tterm-note">{t('row.path.missing')}</div>
      ) : null}
      {!state.supported && state.unsupportedReason !== undefined ? (
        <div className="tterm-note">{t('row.notSupported', { reason: state.unsupportedReason })}</div>
      ) : null}
      {!state.settingsAvailable ? <div className="tterm-note">{t('row.unavailable')}</div> : null}
      {state.notice !== undefined ? <div className="tterm-note">{state.notice}</div> : null}
      {state.error !== undefined ? <div className="tterm-error">{state.error}</div> : null}
      <div className="tterm-note">{t('row.newSession')}</div>
    </div>
  )
}
