import fs from 'node:fs'
import path from 'node:path'

const baseUrl = String(process.env.PERIOD_FIELD_BASE_URL || 'http://127.0.0.1:9191').replace(
  /\/+$/,
  ''
)
const root = process.cwd()
const maxAssets = Number(process.env.PERIOD_FIELD_MAX_ASSETS || 500)
const errors = []

function fail(message) {
  errors.push(message)
}

async function fetchText(url) {
  const response = await fetch(url)
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}: ${text.slice(0, 200)}`)
  }
  return text
}

function assetUrl(value, contextUrl = `${baseUrl}/`) {
  const clean = String(value || '').trim()
  if (!clean || !/\.(js|css)(?:$|\?)/.test(clean)) return ''
  if (clean.startsWith('/assets/')) return new URL(clean, `${baseUrl}/`).toString()
  if (clean.startsWith('assets/')) return new URL(`/${clean}`, `${baseUrl}/`).toString()
  if (clean.startsWith('./assets/') || clean.startsWith('../assets/')) {
    return new URL(clean, contextUrl).toString()
  }
  if (clean.includes('/assets/')) return new URL(clean, contextUrl).toString()
  return ''
}

function assetUrlsFromText(text, contextUrl = `${baseUrl}/`) {
  const urls = new Set()

  for (const match of text.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    const url = assetUrl(match[1], contextUrl)
    if (url) urls.add(url)
  }

  for (const match of text.matchAll(/["'`](\.{0,2}\/?assets\/[^"'`\s)]+?\.(?:js|css)(?:\?[^"'`\s)]*)?)["'`]/g)) {
    const url = assetUrl(match[1], contextUrl)
    if (url) urls.add(url)
  }

  return [...urls]
}

function assertContains(source, needle, message) {
  if (!source.includes(needle)) fail(message)
}

function localDistEntryAssets() {
  const indexPath = path.join(root, 'dist', 'index.html')
  if (!fs.existsSync(indexPath)) return []
  return assetUrlsFromText(fs.readFileSync(indexPath, 'utf8'))
    .map((url) => new URL(url).pathname)
    .sort()
}

async function collectRuntimeAssets(indexHtml) {
  const queue = assetUrlsFromText(indexHtml)
  const seen = new Set()
  const assets = []

  while (queue.length) {
    if (assets.length >= maxAssets) {
      throw new Error(`stopped after ${maxAssets} assets; raise PERIOD_FIELD_MAX_ASSETS if needed`)
    }

    const url = queue.shift()
    if (!url || seen.has(url)) continue
    seen.add(url)

    const text = await fetchText(url)
    assets.push({ url, text })

    for (const next of assetUrlsFromText(text, url)) {
      if (!seen.has(next)) queue.push(next)
    }
  }

  return assets
}

async function main() {
  const indexHtml = await fetchText(`${baseUrl}/`)
  const runtimeAssets = await collectRuntimeAssets(indexHtml)
  if (!runtimeAssets.length) throw new Error('No frontend assets found in runtime index.html')

  const combined = runtimeAssets.map((asset) => asset.text).join('\n')
  const servedEntryAssets = assetUrlsFromText(indexHtml)
    .map((url) => new URL(url).pathname)
    .sort()
  const distEntryAssets = localDistEntryAssets()

  assertContains(combined, '\u6837\u672c\u4e0e\u7ec4\u5b66', 'runtime bundle must include omics field-group title')
  assertContains(combined, '\u8bbe\u5907\u4e0e\u4f20\u611f\u5668', 'runtime bundle must include device field-group title')
  assertContains(combined, '\u751f\u4ea7\u5468\u671f\u7ef4\u5ea6', 'runtime bundle must include information-export production period group')
  assertContains(combined, '\u672c\u80ce\u4ea7\u728a\u65f6\u95f4', 'runtime bundle must expose parity calving date')
  assertContains(combined, '\u73ed\u6b21', 'runtime bundle must expose shift fields')
  assertContains(combined, '\u7b49', 'runtime bundle must include compact group overflow labels')

  if (errors.length) {
    console.error(`[period-field-runtime] checked ${runtimeAssets.length} frontend assets from ${baseUrl}`)
    console.error(`[period-field-runtime] served entry assets: ${servedEntryAssets.join(', ')}`)
    if (distEntryAssets.length) {
      console.error(`[period-field-runtime] local dist entry assets: ${distEntryAssets.join(', ')}`)
    }
    for (const message of errors) console.error(`[period-field-runtime] ${message}`)
    process.exitCode = 1
    return
  }

  console.log(`[period-field-runtime] checked ${runtimeAssets.length} frontend assets from ${baseUrl}`)
  console.log(`[period-field-runtime] served entry assets: ${servedEntryAssets.join(', ')}`)
}

main().catch((error) => {
  console.error(`[period-field-runtime] ${error.message || String(error)}`)
  process.exitCode = 1
})

