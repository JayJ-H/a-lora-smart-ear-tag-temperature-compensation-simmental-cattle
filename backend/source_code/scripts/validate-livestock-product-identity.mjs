import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const checkedRoots = [
  'index.html',
  'README.md',
  'package.json',
  'src',
  'scripts'
]
const excludedDirs = new Set(['node_modules', 'dist'])
const selfFile = path.normalize('scripts/validate-livestock-product-identity.mjs')
const productionName = '牛只健康管理系统'
const forbiddenPatterns = [
  ['prototype/web', 'production sources must not reference the deprecated static prototype archive'],
  ['prototype\\\\web', 'production sources must not reference the deprecated static prototype archive'],
  ['\u5b98\u7f51', 'production sources must not use website/official-site positioning'],
  ['market-workflow', 'production sources must not keep marketplace prototype screenshots'],
  ['\u515c\u552e', 'production sources must not use marketing-sales wording'],
  ['\u6f5c\u5728\u7528\u6237', 'production sources must not use website marketing audience wording'],
  ['\u79d1\u7814\u6570\u636e\u5e73\u53f0', 'product identity must be livestock management, not only research data platform'],
  ['\u6570\u636e\u7ba1\u7406\u5e73\u53f0', 'product identity must be livestock management, not only data management platform'],
  ['\u79d1\u7814\u5e73\u53f0', 'visible seed/config identity must be livestock management, not research platform'],
  ['\u80b2\u79cd\u5e73\u53f0\u6982\u89c8\u770b\u677f', 'dashboard naming must use livestock production identity'],
]

function fail(message) {
  console.error(`[livestock-identity] ${message}`)
  process.exitCode = 1
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function listFiles(target) {
  const absolute = path.join(root, target)
  if (!fs.existsSync(absolute)) return []
  const stat = fs.statSync(absolute)
  if (stat.isFile()) return [target]

  const output = []
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    if (excludedDirs.has(entry.name)) continue
    const child = path.join(target, entry.name)
    if (entry.isDirectory()) output.push(...listFiles(child))
    else if (/\.(vue|ts|js|mjs|json|html|md)$/.test(entry.name)) output.push(child)
  }
  return output
}

function assertContains(source, needle, message) {
  if (!source.includes(needle)) fail(message)
}

for (const relativePath of checkedRoots.flatMap(listFiles)) {
  if (path.normalize(relativePath) === selfFile) continue
  const source = read(relativePath)
  for (const [needle, message] of forbiddenPatterns) {
    if (source.includes(needle)) fail(`${message}: ${relativePath}`)
  }
}

assertContains(read('index.html'), productionName, 'index.html must use livestock management product name')
assertContains(read('src/config/index.ts'), productionName, 'AppConfig system name must use livestock management product name')
assertContains(read('src/locales/langs/zh.json'), productionName, 'Chinese login title must use livestock management product name')
assertContains(read('README.md'), productionName, 'README must use livestock management product name')
assertContains(read('index.html'), '场内生产管理系统', 'index meta description must describe farm production management')

if (!process.exitCode) {
  console.log('[livestock-identity] production product identity is aligned to livestock management')
}
