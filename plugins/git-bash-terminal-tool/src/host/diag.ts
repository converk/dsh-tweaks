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
 * ⚠️ 测试要写自己的文件，别污染这份日志 —— 见 {@link diagFile}。
 *
 * 纪律（AGENTS.md §3.6）：诊断本身失败绝不影响主流程。
 */
import { appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 诊断文件路径：默认 `os.tmpdir()/dsh-git-bash-terminal-tool.log`，可用
 * **`DSH_GIT_BASH_DIAG_FILE`** 覆盖。
 *
 * ⚠️ 这个覆盖不是「锦上添花」，自测**必须**用它。`scripts/selftest.mjs` 会故意调用真
 * `apply()`（为了抓 issue #1 那种「事件名写错就静默失效」的回归），于是它会往这份
 * **生产日志**里写进一堆测试记录：
 *
 * ```text
 * settings: dialect=bash bashPath="C:\Program Files\nodejs\node.exe" candidates=0
 * replace: applied agent=session-1 bash=C:\Program Files\nodejs\node.exe
 * ```
 *
 * 排查「替换为什么没生效」时读到这些，会以为另有一个跑歪了的 DSH 实例 —— 实测就把人
 * 误导过一次（花了十几步去追一个不存在的幽灵实例）。测试必须写自己的临时文件。
 *
 * 每次调用读一次环境变量（而不是模块加载时算一次）：ESM 的静态 import 先于任何语句
 * 执行，自测没有机会在自己的 `import` 之前设置它。
 * @returns 本次要写入的日志文件绝对路径。
 */
export function diagFile(): string {
  const override = process.env.DSH_GIT_BASH_DIAG_FILE
  return override !== undefined && override.length > 0 ? override : join(tmpdir(), 'dsh-git-bash-terminal-tool.log')
}

/**
 * 追加一行诊断。
 * @param line - 已拼好的文本（自动加时间戳与 pid）。
 */
export function diag(line: string): void {
  try {
    appendFileSync(diagFile(), `${new Date().toISOString()} pid=${String(process.pid)} ${line}\n`)
  } catch {
    // 诊断本身失败不影响主流程。
  }
}
