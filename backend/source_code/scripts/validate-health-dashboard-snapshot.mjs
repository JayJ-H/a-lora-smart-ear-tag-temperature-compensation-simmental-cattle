import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluateTwoOfThreeHighTemperature } from './health-alert-rules.mjs'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const backend = fs.readFileSync(path.join(projectRoot, 'scripts/mysql-backend-server.mjs'), 'utf8')
const dashboard = fs.readFileSync(
  path.join(projectRoot, 'src/views/dashboard/board/index.vue'),
  'utf8'
)
const nginx = fs.readFileSync(path.join(projectRoot, 'ops/production/nginx.conf'), 'utf8')

assert.match(backend, /async function getHealthDashboardSnapshot\(options = \{\}\)/)
assert.match(backend, /case 'getHealthDashboardSnapshot'/)
assert.match(backend, /ROW_NUMBER\(\) OVER/)
assert.match(backend, /metric_code = 'body_temperature'/)
assert.match(backend, /queryMode: 'compact-latest-three'/)
assert.match(dashboard, /runBackendRpcAsync<HealthDashboardSnapshot>/)
assert.match(dashboard, /'getHealthDashboardSnapshot'/)
assert.match(dashboard, /\{ perCowLimit: 3 \}/)
assert.match(nginx, /gzip_static on;/)

const adjacent = evaluateTwoOfThreeHighTemperature([
  { temperature: 39.6, measuredAt: '2026-07-20T08:00:00+08:00' },
  { temperature: 39.7, measuredAt: '2026-07-20T08:10:00+08:00' },
  { temperature: 39.2, measuredAt: '2026-07-20T08:20:00+08:00' }
])
const firstLast = evaluateTwoOfThreeHighTemperature([
  { temperature: 39.6, measuredAt: '2026-07-20T08:00:00+08:00' },
  { temperature: 39.2, measuredAt: '2026-07-20T08:10:00+08:00' },
  { temperature: 39.7, measuredAt: '2026-07-20T08:20:00+08:00' }
])
const boundary = evaluateTwoOfThreeHighTemperature([
  { temperature: 39.5, measuredAt: '2026-07-20T08:00:00+08:00' },
  { temperature: 39.5, measuredAt: '2026-07-20T08:10:00+08:00' },
  { temperature: 39.6, measuredAt: '2026-07-20T08:20:00+08:00' }
])

assert.equal(adjacent.matched, true)
assert.equal(firstLast.matched, true)
assert.equal(boundary.matched, false)

console.log(
  JSON.stringify(
    {
      ok: true,
      rpc: 'getHealthDashboardSnapshot',
      queryMode: 'compact-latest-three',
      alertRule: {
        adjacent: adjacent.matched,
        firstLast: firstLast.matched,
        strictBoundary: boundary.matched
      },
      gzipStatic: true
    },
    null,
    2
  )
)
