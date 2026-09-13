/**
 * 注册诊断日志（每次启动往临时目录追加一行）。
 *
 * 为什么需要它：宿主半区是 Node ESM，改宿主代码必须重启 dsh 才生效；而
 * 「替换没生效 / 路由没挂上」在浏览器侧只表现为静默（界面毫无反应），宿主
 * stdout 又不在插件手里。所以关键动作都写一行到：
 *
 * ```
 * %TEMP%\dsh-git-bash-terminal-tool.log   （Windows；其他平台为 os.tmpdir()）
 * 2026-09-13T23:41:35.123Z pid=19604 register: rpc=ok
 * ```
 *
 * 纪律（AGENTS.md §2.6）：诊断本身失败绝不影响主流程。
 */
import { appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** 诊断文件路径（`os.tmpdir()` 下）。 */
export const DIAG_FILE = join(tmpdir(), 'dsh-git-bash-terminal-tool.log')

/**
 * 追加一行诊断。
 * @param line - 已拼好的文本（自动加时间戳与 pid）。
 */
export function diag(line: string): void {
  try {
    appendFileSync(DIAG_FILE, `${new Date().toISOString()} pid=${String(process.pid)} ${line}\n`)
  } catch {
    // 诊断本身失败不影响主流程。
  }
}
