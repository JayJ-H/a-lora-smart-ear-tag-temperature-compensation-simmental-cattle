import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const nextScript = path.join(scriptDir, 'regenerate-shift-milk-import-package.mjs')
const sourceFile =
  process.argv[2] || path.resolve('test-fixtures/shift-milk/source-workbook.xlsx')
const outputDir = process.argv[3] || path.resolve('artifacts/shift-milk/system-import-package')

console.warn(
  [
    'translate-shift-milk-workbook.mjs 已废弃。',
    '现在统一使用 regenerate-shift-milk-import-package.mjs：先按源列语义映射到系统字段/字典/派生字段，再生成可导入模板。',
    '不会再把源表头直接搬进目标模板。'
  ].join('\n')
)

const result = spawnSync(process.execPath, [nextScript, sourceFile, outputDir], {
  stdio: 'inherit'
})

process.exit(result.status ?? 1)
