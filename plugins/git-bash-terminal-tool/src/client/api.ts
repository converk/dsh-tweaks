/**
 * 浏览器半区对宿主 `/api` 精确路由的调用（AGENTS.md §2.4）。
 *
 * 与 `settingsScope` 的分工：
 * - **读状态 / 扫描候选** 走这里（宿主才能访问文件系统与注册表）；
 * - **写设置** 走 `settingsScope`（共用官方设置通道，host 的 validate 把关）。
 */
import { ROUTE_DISCOVER, ROUTE_STATE } from '../shared/protocol.js'
import type { DiscoverView, StateView } from '../shared/protocol.js'

/** 统一 POST 一个 JSON 端点；非 2xx 或结构不对时抛错。 */
async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    ...(signal !== undefined ? { signal } : {}),
  })
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
  const parsed: unknown = await response.json()
  if (typeof parsed === 'object' && parsed !== null && 'ok' in parsed && (parsed as { ok?: unknown }).ok === false) {
    const message = (parsed as { error?: unknown }).error
    throw new Error(typeof message === 'string' && message.length > 0 ? message : 'host reported a failure')
  }
  return parsed as T
}

/**
 * 读宿主状态（平台、候选、能力探测、最近替换结果）。
 * @param signal - 取消信号。
 * @returns `/state` 的返回值。
 */
export function fetchState(signal?: AbortSignal): Promise<StateView> {
  return post<StateView>(ROUTE_STATE, {}, signal)
}

/**
 * 让宿主重新扫描一次 Git Bash 候选（纯查询、无副作用）。
 * @param saved - 当前已保存的路径（会作为「saved」来源排在候选最前）。
 * @param signal - 取消信号。
 * @returns `/discover` 的返回值。
 */
export function fetchCandidates(saved?: string, signal?: AbortSignal): Promise<DiscoverView> {
  return post<DiscoverView>(ROUTE_DISCOVER, saved !== undefined && saved.length > 0 ? { bashPath: saved } : {}, signal)
}
