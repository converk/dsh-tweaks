/**
 * DSH 兼容闸门：把本插件依赖的每一条官方契约，在**指定 DSH 版本的官方产物**上逐条断言。
 *
 * 为什么需要单独一个脚本：本插件对 DSH 的依赖全是「结构性窄化投影」（AGENTS.md §3.9），
 * 没有编译期/运行期依赖，所以官方换代时**不会有任何编译错误** —— 契约漂移只会表现为
 * 运行期静默失效。issue #1 就是这么来的：agent/session-start 自 DSH 0.1.6 起被官方移除，
 * 插件照常加载、日志无异常、设置行正常，只是**永远不替换**（模型仍只看到 pwsh）。
 *
 * 用法：
 *   node scripts/compatcheck.mjs                       # 用 DSH_STABLE_HOME（无则报错退出）
 *   node scripts/compatcheck.mjs <DSH 安装目录> [...]   # 离线：直接查现成部署
 *   node scripts/compatcheck.mjs --fetch <版本> [...]   # 联网：npm pack 官方产物到 .compat-cache/
 *
 * ⚠️ 先跑 node build.mjs：断言里的 AGENT_INIT_EVENT 取自**构建产物** lib/index.js，
 * 而不是源码常量（这样顺带验证了 bundle 可加载）。
 */
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { AGENT_INIT_EVENT } from '../lib/index.js'

const here = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const cacheRoot = join(here, '.compat-cache')

let passed = 0
let failed = 0
/** 缺失时插件有降级路径的契约（只告警，不计入 failed）；当前契约集里没有可选契约。 */
let optional = 0

/** 一个断言。 */
function check(name, condition, detail) {
  if (condition) {
    passed += 1
    console.log('  ok   ' + name)
    return
  }
  failed += 1
  console.log('  FAIL ' + name + (detail === undefined ? '' : ' — ' + detail))
}

/** 递归列出目录下所有文件（绝对路径）。 */
function listFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listFiles(full))
    else if (entry.isFile()) out.push(full)
  }
  return out
}

/** 把某个包下指定扩展名的文件拼成一段文本（找不到文件时返回 undefined）。 */
function readPackageText(packageDir, extensions) {
  if (!existsSync(packageDir)) return undefined
  const files = listFiles(packageDir).filter((file) => extensions.some((ext) => file.endsWith(ext)))
  if (files.length === 0) return undefined
  return files.map((file) => readFileSync(file, 'utf8')).join('\n/* ---- */\n')
}

/**
 * 本插件依赖的官方契约（每条都是「缺失即运行期静默失效」的那种）。
 *
 * needles 全部命中才算过；文案改了就是契约改了 —— 宁可这里红，也不要用户端静默。
 */
const CONTRACTS = [
  {
    id: 'dsh-agent：per-agent 初始化事件与 Agent.ctx',
    pkg: 'dsh-agent',
    ext: ['.d.ts'],
    needles: ["'agent/created'(this: Scoped<Agent>", 'readonly ctx: Context'],
  },
  {
    id: 'dsh-agent：agent/created 真的会被派发（运行时代码）',
    pkg: 'dsh-agent',
    ext: ['.js'],
    needles: ['agent/created'],
  },
  {
    id: 'dsh-tools：register / restrict（agent scope 工具面）',
    pkg: 'dsh-tools',
    ext: ['.d.ts'],
    needles: ['register(definition: ToolDefinition)', 'restrict(filter: ToolRestriction)'],
  },
  {
    id: 'dsh-tools：restrict 的 scoped + 未知名抛错语义（插件靠抛错判断 pwsh 是否已隐藏）',
    pkg: 'dsh-tools',
    ext: ['.js'],
    needles: ['requires a scoped context', 'names unknown global tool'],
  },
  {
    id: 'dsh-system-prompt：section（压掉 tool:pwsh 提示词）',
    pkg: 'dsh-system-prompt',
    ext: ['.d.ts'],
    needles: ['section(section: PromptSection)'],
  },
  {
    id: 'dsh-sandbox：confine 的入参与返回结构（插件靠 runnerFailureRules / denialSignatures 判沙箱事实）',
    pkg: 'dsh-sandbox',
    ext: ['.d.ts'],
    needles: ['confine(argv: readonly string[], policy: SandboxPolicy', 'denialSignatures', 'runnerFailureRules'],
  },
  {
    // 0.1.6 起 confine 是 async：忘了 await 会拿到 Promise（argv undefined）→ 运行期静默失败。
    id: 'dsh-sandbox-local：confine 是 async（必须 await）',
    pkg: 'dsh-sandbox-local',
    ext: ['.js'],
    needles: ['async confine('],
  },
  {
    // —— 后台任务的**输出通道** ——
    // ⚠️ 注册表只认 `start({ output: [...] })` 的拉取源：它按源把 stdout/stderr 泵进任务的
    // 输出环，`job_output` 读的就是那个环。少给、或换成别的写法（例如在 hooks 上返回
    // `readOutput()`），**都不报错**：任务照常跑完、状态也对，但输出永远是空的。
    id: 'dsh-jobs-local：start 的输出拉取源（output）与环泵',
    pkg: 'dsh-jobs-local',
    ext: ['.js'],
    needles: ['startPump(spec.output.map', 'outputLimitBytes', 'spec.run(handle)'],
  },
  {
    // 归属：owner 必须是 **agent id（session id）字符串**，注册表拿它反查活着的 agent。
    // 传 agent 对象会抛 `session "[object Object]" has no live agent`。
    id: 'dsh-jobs-local：owner 解析（owner 必须是 agent id，不是 agent 对象）',
    pkg: 'dsh-jobs-local',
    ext: ['.js'],
    needles: ['resolveOwner(session)', 'agents.get(session)'],
  },
  {
    // promote 能力（前台等超时后「转后台」）的硬契约：注册表必须齐 wait/read/kill/remove。
    // 自 0.4.1 起最低支持 DSH 0.2.0；0.2.0-rc.2 的 dsh-jobs 产物已实测四者俱全，缺任一个即报红。
    // （插件运行期仍保留能力探测做防御式降级，但兼容闸门按硬契约查。）
    id: 'dsh-jobs：wait/read/kill/remove（前台超时转后台）',
    pkg: 'dsh-jobs',
    ext: ['.d.ts'],
    needles: ['wait(', 'read(', 'kill(', 'remove('],
  },
]

/** 解析一个安装目录里某个包的目录。 */
function packageDir(root, pkg) {
  const candidates = [
    join(root, 'node_modules/@deepseek-ai', pkg),
    join(root, '@deepseek-ai', pkg),
    join(root, pkg),
  ]
  return candidates.find((dir) => existsSync(join(dir, 'package.json')))
}

/** 从 dsh-agent 的 d.ts 里解析出 Events 接口声明的事件名。 */
function declaredEvents(text) {
  return [...text.matchAll(/^\s*'([a-z-]+\/[a-z-]+)'\(/gm)].map((match) => match[1])
}

/** 检查一个目标目录（DSH 安装目录，或提取出来的包集合）。 */
function checkTarget(label, root) {
  console.log('\n== ' + label)
  const agentDir = packageDir(root, 'dsh-agent')
  if (agentDir === undefined) {
    check('找得到 dsh-agent', false, root)
    return
  }
  const version = JSON.parse(readFileSync(join(agentDir, 'package.json'), 'utf8')).version
  console.log('  info dsh-agent ' + version)

  for (const contract of CONTRACTS) {
    const dir = packageDir(root, contract.pkg)
    if (dir === undefined) {
      check(contract.id, false, '找不到包 ' + contract.pkg)
      continue
    }
    const text = readPackageText(dir, contract.ext)
    if (text === undefined) {
      check(contract.id, false, contract.pkg + ' 下没有 ' + contract.ext.join('/') + ' 文件')
      continue
    }
    const missing = contract.needles.filter((needle) => !text.includes(needle))
    if (missing.length === 0) {
      check(contract.id, true)
    } else if (contract.optional === true) {
      // 可选契约（当前为空）：缺失时插件有明确降级路径，只告警、不计失败。
      optional += 1
      console.log(
        '  warn ' + contract.id + ' — ' + missing.map((m) => '缺 "' + m + '"').join('; ') + '（可选：插件会自动降级）',
      )
    } else {
      check(contract.id, false, missing.map((m) => '缺 "' + m + '"').join('; '))
    }
  }

  // 最关键的一条：插件订阅的事件名必须真的在官方事件表里。
  const typesText = readPackageText(agentDir, ['.d.ts']) ?? ''
  const events = declaredEvents(typesText)
  check(
    '插件订阅的 ' + AGENT_INIT_EVENT + ' 在官方事件表里',
    events.includes(AGENT_INIT_EVENT),
    events.length === 0 ? '没解析到任何事件声明' : '已声明：' + events.join(', '),
  )
  check(
    '旧事件名 agent/session-start 已不在事件表里（写回去就是死订阅）',
    !events.includes('agent/session-start'),
  )
}

/** 联网：把某个 DSH 版本的官方产物 npm pack 到 .compat-cache/<版本>/，还原成安装目录布局。 */
function fetchVersion(version) {
  const dir = join(cacheRoot, version)
  const scope = join(dir, 'node_modules/@deepseek-ai')
  for (const pkg of new Set(CONTRACTS.map((contract) => contract.pkg))) {
    const dest = join(scope, pkg)
    if (existsSync(join(dest, 'package.json'))) continue
    mkdirSync(dest, { recursive: true })
    execSync('npm pack "' + '@deepseek-ai/' + pkg + '@' + version + '" --silent', {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    const tgz = readdirSync(dir).find((name) => name.endsWith('.tgz'))
    if (tgz === undefined) throw new Error('npm pack 没有产出 tarball：' + pkg + '@' + version)
    // ⚠️ 别把含盘符的绝对路径交给 tar：MSYS / GNU tar 会把 `D:` 当成**远程主机**
    // （`tar: Cannot connect to D: resolve failed`），Windows 上 --fetch 直接崩。
    // 先把 tarball 挪进目标目录，再用相对文件名解包即可。
    renameSync(join(dir, tgz), join(dest, tgz))
    execSync('tar -xzf "' + tgz + '" --strip-components=1', {
      cwd: dest,
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    rmSync(join(dest, tgz))
  }
  return dir
}

// ---------------------------------------------------------------------------

const argv = process.argv.slice(2)
let targets = []
if (argv[0] === '--fetch') {
  for (const version of argv.slice(1)) {
    console.log('info 拉取 @deepseek-ai/dsh-*@' + version + ' ——')
    targets.push(['DSH ' + version + '（npm）', fetchVersion(version)])
  }
} else if (argv.length > 0) {
  targets = argv.map((dir) => [dir, resolve(dir)])
} else if (process.env.DSH_STABLE_HOME) {
  targets = [[process.env.DSH_STABLE_HOME, resolve(process.env.DSH_STABLE_HOME)]]
} else {
  console.error('用法：node scripts/compatcheck.mjs [<DSH 安装目录>…] | --fetch <版本>… | DSH_STABLE_HOME=<目录>')
  process.exit(2)
}

for (const entry of targets) checkTarget(entry[0], entry[1])

console.log('\n' + passed + ' passed, ' + failed + ' failed' + (optional > 0 ? '（另有 ' + optional + ' 条可选契约缺失，已自动降级）' : ''))
if (failed > 0) process.exitCode = 1
