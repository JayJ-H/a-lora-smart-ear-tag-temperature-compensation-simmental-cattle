import fs from 'node:fs'
import path from 'node:path'

const baseUrl = String(process.env.INFORMATION_EXPORT_RUNTIME_URL || process.argv[2] || 'http://127.0.0.1:9191').replace(/\/+$/, '')
const projectRoot = process.cwd()
const errors = []

async function fetchText(url) {
  const response = await fetch(url)
  const text = await response.text()
  if (!response.ok) throw new Error(`${url} returned ${response.status}: ${text.slice(0, 200)}`)
  return text
}

function assetUrlsFromHtml(html) {
  return [...html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css))["']/g)]
    .map((match) => new URL(match[1], `${baseUrl}/`).toString())
}

function localDistEntryAssets() {
  const indexPath = path.join(projectRoot, 'dist', 'index.html')
  if (!fs.existsSync(indexPath)) return []
  return assetUrlsFromHtml(fs.readFileSync(indexPath, 'utf8')).map((url) => new URL(url).pathname).sort()
}

function fail(message) {
  errors.push(message)
}

async function main() {
  const html = await fetchText(`${baseUrl}/`)
  const servedEntryAssets = assetUrlsFromHtml(html).map((url) => new URL(url).pathname).sort()
  const distEntryAssets = localDistEntryAssets()
  const assets = await Promise.all(assetUrlsFromHtml(html).map(async (url) => ({ url, text: await fetchText(url) })))
  const combined = assets.map((asset) => asset.text).join('\n')

  for (const needle of ['生产周期维度', '本胎产犊时间', '班次', '胎次与泌乳', '采集与操作', '按本胎产犊时间']) {
    if (!combined.includes(needle)) fail(`runtime assets missing "${needle}"`)
  }
  if (distEntryAssets.length && servedEntryAssets.join(',') !== distEntryAssets.join(',')) {
    fail(`runtime entry assets differ from local dist: served=${servedEntryAssets.join(', ')} dist=${distEntryAssets.join(', ')}`)
  }

  const report = {
    ok: errors.length === 0,
    baseUrl,
    servedEntryAssets,
    distEntryAssets,
    errors
  }
  console.log(JSON.stringify(report, null, 2))
  if (errors.length) process.exitCode = 1
}

main().catch((error) => {
  console.error(`[information-export-runtime-assets] ${error.message || String(error)}`)
  process.exitCode = 1
})

