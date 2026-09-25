/**
 * Git Bash 自动发现（纯逻辑 + 可注入的探测缝）。
 *
 * 需求 3（自动发现）与需求 4（找不到就不能选）都由这里支撑。算法按
 * `docs/plans/git-bash-terminal-tool-design.md` §5.2.5 落地：
 *
 * 1. **绝不使用 WSL 的 bash**（决策 A）。本机实测 `where bash` 的第一条就是
 *    `C:\Windows\System32\bash.exe`（WSL 的启动器），所以绝不把裸 `bash` 的
 *    PATH 解析当作兜底 —— 那样必然选到 WSL。
 * 2. **由 git 反推 bash**（决策 C）：接受 Git for Windows / MSYS2 / Cygwin
 *    任何形式的 git，从 `git.exe` 所在目录反推出同一安装里的 `bash.exe`。
 * 3. 注册表 `GitForWindows\InstallPath` 可能是**悬空残留**（本机就是：
 *    指向已不存在的 `D:\env\Git`），所以每个来源都要**逐路径校验存在性**。
 *
 * 本模块只做文件系统与注册表读取，不 import 任何 `@deepseek-ai/*`。
 * 所有外部探测都走 {@link DiscoveryProbes}，`scripts/selftest.mjs` 用它注入
 * 假的文件系统/注册表来驱动这段逻辑。
 */
import { lstatSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { delimiter, dirname, join, resolve, sep } from 'node:path'

/** 候选项的来源分类（同时是排序优先级）。 */
export type BashSource = 'saved' | 'git-for-windows' | 'msys2' | 'cygwin' | 'git-path'

/** 一个候选的 Git Bash 可执行文件。 */
export interface BashCandidate {
  /** 绝对路径。 */
  readonly path: string
  /** 来源分类。 */
  readonly source: BashSource
  /** 是否通过存在性（文件或符号链接）校验。 */
  readonly valid: boolean
  /** `<bash> -c 'bash --version'` 探测结果首行；探测失败/未探测时缺省。 */
  readonly version?: string
}

/** 发现过程的外部探测缝（自测时注入假的实现）。 */
export interface DiscoveryProbes {
  /** 文件（或符号链接）是否存在。 */
  fileExists(path: string): boolean
  /** `where git` 的输出行；不可用时返回空数组。 */
  whereGit(): readonly string[]
  /** 读一条注册表值；没有则返回 undefined。 */
  readRegistry(hive: string, key: string, name: string): string | undefined
  /** 执行 `<bash> -c 'bash --version'` 并返回首行；失败返回 undefined。 */
  probeVersion(bashPath: string): string | undefined
  /** PATH 上的目录（`process.env.PATH` 拆分结果；测试可注入）。 */
  pathDirs(): readonly string[]
  /** 环境变量（`%ProgramFiles%` 等）。 */
  env(name: string): string | undefined
}

/** 来源排序优先级（越小越靠前）。 */
const SOURCE_RANK: Record<BashSource, number> = {
  saved: 0,
  'git-for-windows': 1,
  msys2: 2,
  cygwin: 3,
  'git-path': 4,
}

/** Git for Windows 注册表位置（含 32 位视图）。 */
const GIT_FOR_WINDOWS_KEYS: readonly { hive: string; key: string }[] = [
  { hive: 'HKLM', key: 'SOFTWARE\\GitForWindows' },
  { hive: 'HKLM', key: 'SOFTWARE\\WOW6432Node\\GitForWindows' },
]

/** 常见的 Git Bash 安装根目录（由 git 根推 bash 时会再探同样的相对位置）。 */
const KNOWN_GIT_ROOTS: readonly string[] = [
  '%ProgramFiles%\\Git',
  '%ProgramFiles(x86)%\\Git',
  '%LOCALAPPDATA%\\Programs\\Git',
]

/** 常见的 MSYS2 根目录。 */
const KNOWN_MSYS2_ROOTS: readonly string[] = ['C:\\msys64', 'C:\\msys32', 'D:\\msys64', '%SystemDrive%\\msys64']

/** 常见的 Cygwin 根目录。 */
const KNOWN_CYGWIN_ROOTS: readonly string[] = ['C:\\cygwin64', 'C:\\cygwin', 'D:\\cygwin64']

/**
 * 包装成 Windows 长路径前缀，避免超长路径上的 `lstat` 失败。
 *
 * ⚠️ 扩展长度路径前缀是 Windows 专有的：在非 Windows 上必须原样返回，否则 `lstat`
 * 会把这个字面量路径当成不存在的文件（本插件的纯逻辑自测在 Linux CI 上跑，踩过这个坑）。
 * @param path - 待包装的路径。
 * @returns 可交给 `lstat` 的路径。
 */
function toExtendedPath(path: string): string {
  const absolute = resolve(path)
  if (process.platform !== 'win32') return absolute
  if (path.startsWith('\\\\?\\')) return path
  if (absolute.startsWith('\\\\')) return `\\\\?\\UNC\\${absolute.slice(2)}`
  return `\\\\?\\${absolute}`
}

/**
 * 校验一个路径是文件或符号链接（口径对齐 `dsh-pwsh-local` 的 `candidateExists`：
 * 符号链接也算，因为 Git Bash 常以 junction/软链形式出现）。
 * @param path - 待校验的绝对路径。
 * @returns 该路径是否可作为可执行文件使用。
 */
export function fileOrLinkExists(path: string): boolean {
  try {
    const stat = lstatSync(toExtendedPath(path))
    return stat.isFile() || stat.isSymbolicLink()
  } catch {
    return false
  }
}

/** 路径去重键：绝对化、分隔符统一、去尾部分隔符、小写。 */
export function normalizePathKey(path: string): string {
  let key = resolve(path).replace(/[\\/]+$/, '')
  if (key.length === 0) key = sep
  return key.replace(/\//g, '\\').toLowerCase()
}

/** WSL 的 bash 所在目录（硬排除，决策 A；连兜底都不做）。 */
function wslBashDirs(env: (name: string) => string | undefined): readonly string[] {
  const windowsDir = env('SystemRoot') ?? env('windir') ?? 'C:\\Windows'
  const localAppData = env('LOCALAPPDATA')
  const dirs = [join(windowsDir, 'System32'), join(windowsDir, 'Sysnative')]
  if (localAppData !== undefined && localAppData.length > 0) {
    dirs.push(join(localAppData, 'Microsoft', 'WindowsApps'))
  }
  return dirs.map((dir) => normalizePathKey(dir))
}

/**
 * 判断一个路径是否命中必须硬排除的 WSL bash。
 *
 * 命中 `%SystemRoot%\System32\bash.exe`、`%SystemRoot%\Sysnative\bash.exe` 或
 * `...\WindowsApps\bash.exe` 时返回 true（决策 A：绝不使用 WSL 的 bash）。
 * @param path - 候选路径。
 * @param env - 环境变量读取器（测试可注入）。
 * @returns 是否必须丢弃该候选。
 */
export function isBlockedBash(path: string, env: (name: string) => string | undefined): boolean {
  const key = normalizePathKey(path)
  if (!key.endsWith('\\bash.exe')) return false
  return wslBashDirs(env).some((dir) => key.startsWith(`${dir}\\`))
}

/** 展开 `%NAME%` 形式的变量引用；未定义的变量返回 undefined（该根被丢弃）。 */
function expandEnvPath(template: string, env: (name: string) => string | undefined): string | undefined {
  let failed = false
  const expanded = template.replace(/%([^%]+)%/g, (_match, name: string) => {
    const value = env(name)
    if (value === undefined || value.length === 0) {
      failed = true
      return ''
    }
    return value
  })
  return failed ? undefined : expanded
}

/**
 * 由一个安装根推出该安装里所有可能的 bash 路径（不做存在性校验）。
 *
 * 覆盖 Git for Windows（`bin` / `usr\bin`）、MSYS2（`usr\bin` / `bin`）与
 * Cygwin（`bin`）三种布局，顺序即优先级。
 * @param root - 安装根目录。
 * @returns 候选 bash 绝对路径列表（可能包含不存在的路径）。
 */
export function bashCandidatesForRoot(root: string): string[] {
  return [
    join(root, 'bin', 'bash.exe'),
    join(root, 'usr', 'bin', 'bash.exe'),
    join(root, 'cmd', 'bash.exe'),
  ]
}

/**
 * 由 PATH 上的一个 `git.exe` 反推同一安装里的 bash（决策 C 最关键的一条，
 * 覆盖非默认安装位置）。
 * @param gitExe - `git.exe` 的绝对路径。
 * @returns 候选 bash 绝对路径列表（去重、保序）。
 */
export function deriveBashFromGitExe(gitExe: string): string[] {
  const dir = dirname(gitExe)
  const parent = dirname(dir)
  const grandparent = dirname(parent)
  const derived = [
    // MSYS2 / Cygwin：git 就在 bash 同级的 bin 目录里。
    join(dir, 'bash.exe'),
    // MSYS2 的 `usr\bin\git.exe` → 根 \usr\bin\bash.exe（同一路径，冗余但便宜）。
    join(dir, '..', 'usr', 'bin', 'bash.exe'),
    // Git for Windows：`<root>\mingw64\bin\git.exe` / `<root>\cmd\git.exe`。
    join(dir, '..', '..', 'bin', 'bash.exe'),
    join(grandparent, 'bin', 'bash.exe'),
    // Git for Windows：`<root>\cmd\git.exe` → `<root>\usr\bin\bash.exe`。
    join(dir, '..', '..', 'usr', 'bin', 'bash.exe'),
    join(grandparent, 'usr', 'bin', 'bash.exe'),
    // Cygwin 变体：`<root>\bin\git.exe` 的上一级。
    join(parent, 'bin', 'bash.exe'),
  ]
  return uniquePaths(derived)
}

/** 由安装根（git 存在的地方）反推 bash。 */
export function deriveBashFromGitRoot(root: string): string[] {
  return uniquePaths([
    ...bashCandidatesForRoot(root),
    ...deriveBashFromGitExe(join(root, 'cmd', 'git.exe')),
    ...deriveBashFromGitExe(join(root, 'mingw64', 'bin', 'git.exe')),
  ])
}

/** 按 Windows 路径语义去重（保留首次出现顺序）。 */
function uniquePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const path of paths) {
    const key = normalizePathKey(path)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(resolve(path))
  }
  return out
}

/** 从一组根目录里收集存在的候选 bash，并记录来源。 */
function collectFromRoots(
  roots: readonly string[],
  source: BashSource,
  probes: DiscoveryProbes,
): { path: string; source: BashSource }[] {
  const found: { path: string; source: BashSource }[] = []
  for (const root of roots) {
    if (!existsAsFile(probes, root)) continue
    for (const candidate of bashCandidatesForRoot(root)) {
      if (existsAsFile(probes, candidate)) found.push({ path: resolve(candidate), source })
    }
  }
  return found
}

/** 默认探测实现（真实文件系统 / `where` / 注册表 / 版本探测）。 */
export function defaultProbes(): DiscoveryProbes {
  const env = (name: string): string | undefined => process.env[name]
  return {
    fileExists: fileOrLinkExists,
    whereGit: () => {
      try {
        const result = spawnSync('where.exe', ['git'], { encoding: 'utf8', windowsHide: true, timeout: 5000 })
        if (result.status !== 0 || typeof result.stdout !== 'string') return []
        return result.stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.toLowerCase().endsWith('git.exe'))
      } catch {
        return []
      }
    },
    readRegistry: (hive, key, name) => {
      try {
        const result = spawnSync('reg.exe', ['query', `${hive}\\${key}`, '/v', name], {
          encoding: 'utf8',
          windowsHide: true,
          timeout: 5000,
        })
        if (result.status !== 0 || typeof result.stdout !== 'string') return undefined
        const match = /REG_[A-Z_]+\s+(.+?)\s*$/m.exec(result.stdout)
        const value = match?.[1]?.trim()
        return value !== undefined && value.length > 0 ? value : undefined
      } catch {
        return undefined
      }
    },
    probeVersion: (bashPath) => {
      try {
        const result = spawnSync(bashPath, ['-c', 'bash --version'], {
          encoding: 'utf8',
          windowsHide: true,
          timeout: 5000,
        })
        if (result.status !== 0 || typeof result.stdout !== 'string') return undefined
        const first = result.stdout.split(/\r?\n/)[0]?.trim()
        return first !== undefined && first.length > 0 ? first : undefined
      } catch {
        return undefined
      }
    },
    pathDirs: () => (process.env.PATH ?? '').split(delimiter).filter((entry) => entry.length > 0),
    env,
  }
}

/** 由 PATH 目录直接探测 git（`where` 不可用时的窗口兜底，不额外起进程）。 */
function gitFromPathDirs(probes: DiscoveryProbes): string[] {
  const found: string[] = []
  for (const dir of probes.pathDirs()) {
    for (const relative of ['git.exe', join('cmd', 'git.exe'), join('bin', 'git.exe'), join('usr', 'bin', 'git.exe')]) {
      const candidate = join(dir, relative)
      if (existsAsFile(probes, candidate)) found.push(resolve(candidate))
    }
  }
  return found
}

/** 收集 PATH 上的 git.exe（`where` 优先，PATH 目视兜底）。 */
export function discoverGitExecutables(probes: DiscoveryProbes): string[] {
  const fromWhere = probes.whereGit().map((line) => resolve(line))
  const existing = fromWhere.filter((path) => existsAsFile(probes, path))
  const merged = existing.length > 0 ? existing : gitFromPathDirs(probes)
  return uniquePaths(merged)
}

/**
 * 扫描并返回排序后的候选列表。
 *
 * 顺序：来源优先级（saved > git-for-windows > msys2 > cygwin > git-path），
 * 同源内按路径字典序，结果稳定可复现。命中 WSL 的路径**直接丢弃**。
 * @param options - `saved`（用户已保存的 `bashPath`，排最前）与探测缝。
 * @returns 候选列表（可能为空 → 需求 4 的置灰条件）。
 */
export function discoverBash(options: { saved?: string | undefined; probes?: DiscoveryProbes } = {}): BashCandidate[] {
  const probes = options.probes ?? defaultProbes()
  const env = (name: string): string | undefined => probes.env(name)
  const collected: { path: string; source: BashSource }[] = []

  const push = (path: string | undefined, source: BashSource): void => {
    if (path === undefined || path.length === 0) return
    if (isBlockedBash(path, env)) return
    collected.push({ path: resolve(path), source })
  }

  // 1) 已保存的路径永远排最前（但绝不自动改写用户已有的选择）。
  if (options.saved !== undefined && options.saved.length > 0) push(options.saved, 'saved')

  // 2) Git for Windows 注册表（目录不存在就丢弃 —— 本机就是悬空残留）。
  for (const entry of GIT_FOR_WINDOWS_KEYS) {
    const root = probes.readRegistry(entry.hive, entry.key, 'InstallPath')
    if (root === undefined || !existsAsFile(probes, root)) continue
    for (const entry of existingBashOfRoot(root, 'git-for-windows', probes)) push(entry.path, entry.source)
  }

  // 3) Git for Windows 默认安装路径。
  for (const template of KNOWN_GIT_ROOTS) {
    const root = expandEnvPath(template, env)
    if (root === undefined || !existsAsFile(probes, root)) continue
    for (const entry of existingBashOfRoot(root, 'git-for-windows', probes)) push(entry.path, entry.source)
  }

  // 4) MSYS2 常见根。
  const msys2Roots = KNOWN_MSYS2_ROOTS.map((template) => expandEnvPath(template, env)).filter(
    (root): root is string => root !== undefined,
  )
  for (const entry of collectFromRoots(msys2Roots, 'msys2', probes)) push(entry.path, entry.source)

  // 5) Cygwin 常见根。
  const cygwinRoots = KNOWN_CYGWIN_ROOTS.map((template) => expandEnvPath(template, env)).filter(
    (root): root is string => root !== undefined,
  )
  for (const entry of collectFromRoots(cygwinRoots, 'cygwin', probes)) push(entry.path, entry.source)

  // 6) 由 PATH 上的 git.exe 反推（覆盖非默认安装位置，最关键的一条）。
  for (const gitExe of discoverGitExecutables(probes)) {
    for (const candidate of deriveBashFromGitExe(gitExe)) push(candidate, 'git-path')
  }

  const merged = new Map<string, { path: string; source: BashSource }>()
  for (const entry of collected) {
    const key = normalizePathKey(entry.path)
    const previous = merged.get(key)
    if (previous === undefined || SOURCE_RANK[entry.source] < SOURCE_RANK[previous.source]) merged.set(key, entry)
  }

  const candidates: BashCandidate[] = [...merged.values()].map((entry) => {
    const valid = existsAsFile(probes, entry.path)
    const version = valid ? probes.probeVersion(entry.path) : undefined
    return {
      path: entry.path,
      source: entry.source,
      valid,
      ...(version !== undefined ? { version } : {}),
    }
  })

  return candidates.sort((a, b) => {
    const byRank = SOURCE_RANK[a.source] - SOURCE_RANK[b.source]
    if (byRank !== 0) return byRank
    return a.path.localeCompare(b.path, 'en')
  })
}

/**
 * 校验一个用户/自动填入的 `bashPath` 是否可用（需求 4 的 host 侧兜底）。
 * @param path - 待校验路径。
 * @param probes - 探测缝（测试可注入）。
 * @returns 可用时返回 null，否则返回人类可读的拒绝原因。
 */
export function validateBashPath(path: string, probes: DiscoveryProbes = defaultProbes()): string | null {
  if (path.trim().length === 0) return 'bashPath 不能为空'
  if (isBlockedBash(path, (name) => probes.env(name))) return '不接受 WSL 的 bash.exe（决策 A：绝不使用 WSL）'
  if (!existsAsFile(probes, path)) return `找不到文件：${path}`
  return null
}



/**
 * 统一口径的存在性判断：先把候选路径规范化再问探测缝。
 *
 * 为什么要包一层：注册表读出来的可能是正斜杠写法（`C:/Program Files/Git`），
 * 而探测缝（真实实现或自测注入）按统一规范化的键比较；同时也让候选与校验
 * 走同一条路径规范化路径。
 * @param probes - 探测缝。
 * @param path - 待判断的路径。
 * @returns 是否可作为可执行文件使用。
 */
function existsAsFile(probes: DiscoveryProbes, path: string): boolean {
  return probes.fileExists(resolve(path))
}

/**
 * 从一个确定的安装根里收集**真实存在**的 bash 候选；一个都没有时退回「首选布局」的
 * 期望路径（标为不存在），让 UI 仍能显示「这里本来该有什么」。
 * @param root - 已确认存在的安装根。
 * @param source - 来源分类。
 * @param probes - 探测缝。
 * @returns 候选列表（至少一项）。
 */
function existingBashOfRoot(
  root: string,
  source: BashSource,
  probes: DiscoveryProbes,
): { path: string; source: BashSource }[] {
  const all = deriveBashFromGitRoot(root)
  const found = all.filter((candidate) => existsAsFile(probes, candidate))
  if (found.length > 0) return found.map((candidate) => ({ path: candidate, source }))
  const fallback = bashCandidatesForRoot(root)[0]
  return fallback === undefined ? [] : [{ path: fallback, source }]
}
