/**
 * dsh-tweaks-git-bash-terminal-tool 构建脚本。
 *
 * 产物两件：
 * - lib/index.js  宿主半区（ESM，Loader 直接加载）。
 * - lib/client.js 浏览器半区：经典脚本（非 module），自注册到
 *   `window.__ModuleLoader__`，工厂体为 CJS（裸说明符 react /
 *   react/jsx-runtime 由页面种子模块表解析）。外壳协议与官方
 *   client-ui 插件包一致，必须保留 sourcemap trailer。
 */
import { readFileSync } from 'node:fs'
import { build, context } from 'esbuild'

const watch = process.argv.includes('--watch')
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

/** 宿主半区：ESM，Loader 直接加载。 */
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  packages: 'external',
  logLevel: 'info',
})

/** 浏览器半区工厂外壳：协议见 @deepseek-ai/dsh-client-modules。 */
const clientBanner = [
  'window.__ModuleLoader__.load({',
  `\tid: ${JSON.stringify(pkg.name)},`,
  '\tfactory: (require) => {',
  '\t\tvar module = { exports: {} };',
  '\t\tvar exports = module.exports;',
  '\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });',
].join('\n')
const clientFooter = ['\t\treturn module.exports;', '\t}', '});'].join('\n')

const clientOptions = {
  entryPoints: ['src/client/index.ts'],
  outfile: 'lib/client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime'],
  banner: { js: clientBanner },
  footer: { js: clientFooter },
  sourcemap: true,
  logLevel: 'info',
}

if (watch) {
  const client = await context(clientOptions)
  await client.watch()
  console.log('[git-bash-terminal-tool] client watch 运行中')
} else {
  await build(clientOptions)
}
