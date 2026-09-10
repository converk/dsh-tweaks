/**
 * 注册诊断日志（每次启动往临时目录追加一行）。
 *
 * 为什么需要它：宿主半区是 Node ESM，Loader 用同一条说明符 `import()`，改宿主代码必须重启
 * dsh 才生效；而「通道没挂上」在浏览器侧只表现为静默（界面什么都不显示），宿主 stdout 又不在
 * 插件手里。所以每次注册尝试都把结果写成一行，排查时直接看这个文件：
 *
 * ```
 * %TEMP%\dsh-turn-file-revert.log        （Windows；其他平台为 os.tmpdir()）
 * 2026-09-10T08:41:35.123Z pid=19604 register: rpc=ok fetch=ok
 * ```
 */
import { appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** 诊断文件路径（`os.tmpdir()` 下）。 */
export const DIAG_FILE = join(tmpdir(), 'dsh-turn-file-revert.log')

/**
 * 追加一行诊断。
 * @param line - 已拼好的文本（会自动加时间戳与 pid）。
 */
export function diag(line: string): void {
  try {
    appendFileSync(DIAG_FILE, `${new Date().toISOString()} pid=${String(process.pid)} ${line}\n`)
  } catch {
    // 诊断本身失败不影响注册。
  }
}
