import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import net from 'node:net'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {}
  return Object.fromEntries(
    fs
      .readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=')
        const key = line.slice(0, index).trim()
        let value = line.slice(index + 1).trim()
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1)
        }
        return [key, value]
      })
  )
}

const env = {
  ...readEnvFile(path.join(projectRoot, '.env')),
  ...readEnvFile(path.join(projectRoot, '运维', '生产配置', '.env.prod')),
  ...process.env
}

const useExistingServer = Boolean(
  env.SECURITY_BASE_URL ||
    env.PRODUCTION_BASE_URL ||
    String(env.SECURITY_USE_EXISTING_SERVER || '').toLowerCase() === 'true'
)

let baseUrl = String(
  env.SECURITY_BASE_URL ||
    env.PRODUCTION_BASE_URL ||
    `http://127.0.0.1:${env.WEB_PORT || 9191}`
).replace(/\/+$/, '')
const timeoutMs = Number(env.QA_HTTP_TIMEOUT_MS || env.SECURITY_HTTP_TIMEOUT_MS || 5000)
let adminUser = String(env.SECURITY_ADMIN_USER || env.PRODUCTION_ADMIN_USER || env.ADMIN_USER || '')
let adminPassword = String(env.SECURITY_ADMIN_PASSWORD || env.PRODUCTION_ADMIN_PASSWORD || env.ADMIN_PASSWORD || '')

const checks = []

function addCheck(name, status, details = {}) {
  checks.push({ name, status, details })
}

function apiCode(body) {
  const code = Number(body?.code)
  return Number.isFinite(code) ? code : null
}

function unwrapApi(body) {
  if (body && typeof body === 'object' && '数据' in body && 'code' in body) return body.data
  return body
}

function truncate(value, max = 300) {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > max ? `${text.slice(0, max)}...` : text
}

async function request(pathname, options = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const url = new URL(pathname, baseUrl)
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'content-type': 'application/json',
        ...(options.headers || {})
      },
      signal: controller.signal
    })
    const text = await response.text()
    let body = text
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      // Keep plain text body for diagnostics.
    }
    return {
      ok: true,
      httpStatus: response.status,
      apiCode: apiCode(body),
      body,
      text
    }
  } catch (error) {
    return {
      ok: false,
      httpStatus: 0,
      apiCode: null,
      body: null,
      text: '',
      error: error?.message || String(error)
    }
  } finally {
    clearTimeout(timer)
  }
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

async function waitForHealth(child, output = { stdout: '', stderr: '' }) {
  const started = Date.now()
  while (Date.now() - started < 15000) {
    if (child.exitCode !== null) {
      throw new Error(
        `temporary backend exited early with code ${child.exitCode}\nstdout:\n${output.stdout.trim().slice(-2000)}\nstderr:\n${output.stderr.trim().slice(-2000)}`
      )
    }
    const health = await request('/api/health')
    if (health.httpStatus === 200 && health.apiCode === 200 && unwrapApi(health.body)?.status === 'ok') {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`temporary backend health check timed out\nstdout:\n${output.stdout.trim().slice(-2000)}\nstderr:\n${output.stderr.trim().slice(-2000)}`)
}

async function stopTemporaryBackend(child) {
  if (!child || child.exitCode !== null) return
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        // ignore
      }
      resolve()
    }, 3000)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
    child.kill('SIGTERM')
  })
}

async function startTemporaryBackend() {
  const port = await getFreePort()
  baseUrl = `http://127.0.0.1:${port}`
  adminUser = 'security_validation_user'
  adminPassword = `GateCheck-${Date.now()}-${Math.random().toString(16).slice(2)}`

  const child = spawn(process.execPath, [path.join(projectRoot, '脚本', 'mysql-backend-server.mjs')], {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: '生产配置',
      AUTH_MODE: 'strict',
      ADMIN_USER: adminUser,
      ADMIN_PASSWORD: adminPassword,
      MYSQL_PASSWORD: `mysql-${adminPassword}`,
      MYSQL_ROOT_PASSWORD: `root-${adminPassword}`,
      MQTT_PASSWORD: `mqtt-${adminPassword}`,
      MQTT_ENABLED: 'false',
      MYSQL_HOST: '127.0.0.1',
      MYSQL_PORT: '1',
      MYSQL_DATABASE: 'security_permission_validation',
      MYSQL_USER: 'security_validation',
      MYSQL_API_PORT: String(port)
    }
  })

  const output = { stdout: '', stderr: '' }
  child.stdout.on('数据', (chunk) => {
    output.stdout += String(chunk)
  })
  child.stderr.on('数据', (chunk) => {
    output.stderr += String(chunk)
  })
  await waitForHealth(child, output)
  return child
}

function secretEnvNames() {
  return Object.keys(env)
    .filter((key) => /(PASSWORD|SECRET|TOKEN|PRIVATE|CREDENTIAL|KEY)$/i.test(key))
    .filter((key) => String(env[key] || '').length >= 6)
}

function detectSystemStatusLeaks(statusPayload, rawText) {
  const leaks = []
  const status = statusPayload && typeof statusPayload === 'object' ? statusPayload : {}

  if (status.environment && Object.keys(status.environment).length > 0) {
    leaks.push({
      type: 'environment',
      path: 'environment',
      keys: Object.keys(status.environment)
    })
  }

  if (status.database?.config && Object.keys(status.database.config).length > 0) {
    leaks.push({
      type: 'database_config',
      path: 'database.config',
      keys: Object.keys(status.database.config)
    })
  }

  const countRows = Array.isArray(status.database?.counts) ? status.database.counts : []
  const tableNames = countRows
    .map((item) => item?.table || item?.label)
    .filter(Boolean)
  if (tableNames.length > 0) {
    leaks.push({
      type: 'internal_tables',
      path: 'database.counts',
      tables: tableNames.slice(0, 12),
      total: tableNames.length
    })
  }

  const backendLeakKeys = ['pid', 'nodeVersion', 'platform', 'memoryMb', 'activeSessions']
    .filter((key) => status.backend && status.backend[key] !== undefined)
  if (backendLeakKeys.length > 0) {
    leaks.push({
      type: 'process_runtime',
      path: '管理系统',
      keys: backendLeakKeys
    })
  }

  const serialized = rawText || JSON.stringify(statusPayload || '')
  const leakedSecretNames = secretEnvNames()
    .filter((key) => serialized.includes(String(env[key])))
    .filter((key) => !['VITE_VERSION'].includes(key))
  if (leakedSecretNames.length > 0) {
    leaks.push({
      type: 'secret_value',
      envNames: leakedSecretNames
    })
  }

  const sensitiveKeyPaths = []
  function walk(value, pathParts = []) {
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      const nextPath = [...pathParts, key]
      if (/(password|secret|token|credential)/i.test(key) && child !== undefined && child !== null && child !== '') {
        sensitiveKeyPaths.push(nextPath.join('.'))
      }
      if (typeof child === 'object') walk(child, nextPath)
    }
  }
  walk(status)
  if (sensitiveKeyPaths.length > 0) {
    leaks.push({
      type: 'sensitive_key',
      paths: sensitiveKeyPaths.slice(0, 20)
    })
  }

  return leaks
}

async function login() {
  if (!adminUser || !adminPassword) {
    return {
      ok: false,
      reason: 'missing_admin_credentials'
    }
  }

  const response = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      userName: adminUser,
      password: adminPassword
    })
  })
  const token = response.body?.data?.token || ''
  if (!response.ok || !token) {
    return {
      ok: false,
      reason: 'login_failed',
      httpStatus: response.httpStatus,
      apiCode: response.apiCode,
      body: truncate(response.body || response.error || '')
    }
  }
  return {
    ok: true,
    headers: { Authorization: token },
    httpStatus: response.httpStatus,
    apiCode: response.apiCode
  }
}

function extractRpcHandlerText() {
  const backendPath = path.join(projectRoot, '脚本', 'mysql-backend-server.mjs')
  if (!fs.existsSync(backendPath)) return ''
  const text = fs.readFileSync(backendPath, 'utf8')
  const start = text.indexOf('async function rpcHandler')
  if (start === -1) return text
  const end = text.indexOf('async function clearTableFast', start)
  return text.slice(start, end === -1 ? undefined : end)
}

function getCaseBlock(text, method) {
  const pattern = new RegExp(`case\\s+['"]${method}['"]\\s*:\\s*{?`)
  const match = pattern.exec(text)
  if (!match) return ''
  const after = text.slice(match.index + match[0].length)
  const next = after.search(/\n\s*(case\s+['"]|default\s*:)/)
  return after.slice(0, next === -1 ? undefined : next)
}

function scanDangerousRpcStaticGuards() {
  const handlerText = extractRpcHandlerText()
  const methods = ['resetDatabase', 'clearTableData', 'updateTableData', 'importVirtualCattleDataset']
  return methods
    .map((method) => {
      const block = getCaseBlock(handlerText, method)
      if (!block) return null
      return {
        method,
        hasProductionGuard: /(403|404|forbidden|production|NODE_ENV|AUTH_MODE|disabled|not allowed|deny|forbid)/i.test(block)
      }
    })
    .filter(Boolean)
}

async function main() {
  const temporaryBackend = useExistingServer ? null : await startTemporaryBackend()
  try {
  const unauthRpc = await request('/api/db/rpc', {
    method: 'POST',
    body: JSON.stringify({ method: 'getDataStats' })
  })
  const unauthRpcOk = unauthRpc.httpStatus === 401 || unauthRpc.apiCode === 401
  addCheck(unauthRpcOk ? 'unauth_db_rpc_401' : 'unauth_db_rpc_401', unauthRpcOk ? 'PASS' : 'FAIL', {
    httpStatus: unauthRpc.httpStatus,
    apiCode: unauthRpc.apiCode,
    body: truncate(unauthRpc.body || unauthRpc.error || '')
  })

  const systemStatus = await request('/api/system/status')
  if (!systemStatus.ok || systemStatus.httpStatus >= 400 || Number(systemStatus.apiCode || 200) >= 400) {
    addCheck('unauth_system_status_available_for_negative_scan', 'FAIL', {
      httpStatus: systemStatus.httpStatus,
      apiCode: systemStatus.apiCode,
      body: truncate(systemStatus.body || systemStatus.error || '')
    })
  } else {
    const payload = unwrapApi(systemStatus.body)
    const leaks = detectSystemStatusLeaks(payload, systemStatus.text)
    addCheck('unauth_system_status_no_sensitive_leaks', leaks.length === 0 ? 'PASS' : 'FAIL', {
      httpStatus: systemStatus.httpStatus,
      apiCode: systemStatus.apiCode,
      leaks
    })
  }

  const auth = await login()
  if (!auth.ok) {
    addCheck('dangerous_rpc_guard_with_authenticated_session', 'FAIL', {
      reason: auth.reason,
      httpStatus: auth.httpStatus,
      apiCode: auth.apiCode,
      note: 'Set SECURITY_ADMIN_USER/SECURITY_ADMIN_PASSWORD or ADMIN_USER/ADMIN_PASSWORD to validate production guard.'
    })
  } else {
    const probes = ['dropDatabase', 'truncateTable', 'executeSql'].map((method) => ({
      method,
      payload: { method, tableName: `__qa_forbidden_${Date.now()}_${method.toLowerCase()}` }
    }))
    const results = []
    for (const probe of probes) {
      const response = await request('/api/db/rpc', {
        method: 'POST',
        headers: auth.headers,
        body: JSON.stringify(probe.payload)
      })
      results.push({
        method: probe.method,
        httpStatus: response.httpStatus,
        apiCode: response.apiCode,
        pass: response.httpStatus === 403 || response.httpStatus === 404 || response.apiCode === 403 || response.apiCode === 404,
        body: truncate(response.body || response.error || '')
      })
    }
    addCheck('dangerous_rpc_names_return_403_or_404', results.every((item) => item.pass) ? 'PASS' : 'FAIL', {
      results
    })
  }

  const staticFindings = scanDangerousRpcStaticGuards()
  const unguarded = staticFindings.filter((item) => !item.hasProductionGuard)
  addCheck('registered_bulk_dangerous_rpc_methods_have_static_guard', unguarded.length === 0 ? 'PASS' : 'FAIL', {
    note: 'This check is read-only and does not invoke registered destructive RPC methods.',
    registeredDangerousMethods: staticFindings,
    unguardedMethods: unguarded.map((item) => item.method)
  })

  const report = {
    ok: checks.every((item) => item.status !== 'FAIL'),
    generatedAt: new Date().toISOString(),
    baseUrl,
    readonly: true,
    temporaryBackend: Boolean(temporaryBackend),
    checks
  }

  console.log('\nSecurity permission negative checks')
  console.table(
    checks.map((item) => ({
      name: item.name,
      status: item.status,
      details: truncate(item.details, 180)
    }))
  )
  console.log('\nJSON report')
  console.log(JSON.stringify(report, null, 2))

  if (!report.ok) process.exitCode = 1
  } finally {
    await stopTemporaryBackend(temporaryBackend)
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, baseUrl, error: error?.message || String(error) }, null, 2))
  process.exitCode = 1
})
