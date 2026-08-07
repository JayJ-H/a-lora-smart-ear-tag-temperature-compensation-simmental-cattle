#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const repoRoot = process.cwd()
const envPath = path.join(repoRoot, 'ops', 'production', '.env.prod')
const backupDir = path.join(os.homedir(), '.cattle-management', 'secure-backups')
let mysqlContainer = process.env.MYSQL_CONTAINER_NAME || 'benniu-mysql'

const secretKeys = ['MYSQL_ROOT_PASSWORD', 'MYSQL_PASSWORD', 'ADMIN_PASSWORD', 'MQTT_PASSWORD']

const requiredKeys = [
  'MYSQL_ROOT_PASSWORD',
  'MYSQL_USER',
  'MYSQL_PASSWORD',
  'ADMIN_PASSWORD',
  'MQTT_USERNAME',
  'MQTT_PASSWORD'
]

function fail(message) {
  console.error(`ERROR: ${message}`)
  process.exit(1)
}

function timestamp() {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
}

function generateSecret() {
  return crypto.randomBytes(36).toString('base64url')
}

function parseEnv(text) {
  const entries = new Map()
  const lines = text.split(/\r?\n/)

  for (const line of lines) {
    if (!line || /^\s*#/.test(line) || !line.includes('=')) continue
    const idx = line.indexOf('=')
    const key = line.slice(0, idx).trim()
    const value = line.slice(idx + 1)
    entries.set(key, value)
  }

  return { entries, lines }
}

function renderEnv(lines, replacements) {
  const seen = new Set()
  const rendered = lines.map((line) => {
    if (!line || /^\s*#/.test(line) || !line.includes('=')) return line
    const idx = line.indexOf('=')
    const key = line.slice(0, idx).trim()
    if (!replacements.has(key)) return line
    seen.add(key)
    return `${key}=${replacements.get(key)}`
  })

  for (const [key, value] of replacements) {
    if (!seen.has(key)) rendered.push(`${key}=${value}`)
  }

  return rendered.join(os.EOL).replace(/\s*$/, os.EOL)
}

function sqlString(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`
}

function sqlAccount(user, host) {
  return `${sqlString(user)}@${sqlString(host)}`
}

function runMysql(sql) {
  const result = spawnSync(
    'docker',
    [
      'exec',
      '-i',
      mysqlContainer,
      'sh',
      '-c',
      'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot --batch --raw --silent'
    ],
    {
      input: sql,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024
    }
  )

  if (result.status !== 0) {
    const err = (result.stderr || result.stdout || '').trim()
    fail(`mysql command failed${err ? `: ${err}` : ''}`)
  }

  return result.stdout
}

if (!fs.existsSync(envPath)) {
  fail('ops/production/.env.prod not found')
}

const originalText = fs.readFileSync(envPath, 'utf8')
const { entries, lines } = parseEnv(originalText)
mysqlContainer = entries.get('MYSQL_CONTAINER_NAME') || mysqlContainer

const missing = requiredKeys.filter((key) => !entries.has(key) || !String(entries.get(key)).trim())
if (missing.length) {
  fail(`required env keys missing or empty: ${missing.join(', ')}`)
}

const mysqlUser = entries.get('MYSQL_USER')
if (!/^[A-Za-z0-9_.-]{1,64}$/.test(mysqlUser)) {
  fail('MYSQL_USER contains unsupported characters for automated rotation')
}

fs.mkdirSync(backupDir, { recursive: true })
const backupPath = path.join(backupDir, `.env.prod.${timestamp()}.bak`)
fs.copyFileSync(envPath, backupPath)
console.log(`backup_created=${backupPath}`)

const nextSecrets = new Map(secretKeys.map((key) => [key, generateSecret()]))

const accountsOutput = runMysql(
  [
    'SELECT User, Host',
    'FROM mysql.user',
    `WHERE User IN (${sqlString('root')}, ${sqlString(mysqlUser)})`,
    'ORDER BY User, Host;'
  ].join(' ') + '\n'
)

const accounts = accountsOutput
  .trim()
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => {
    const [user, host] = line.split('\t')
    return { user, host }
  })

const rootAccounts = accounts.filter((account) => account.user === 'root')
const appAccounts = accounts.filter((account) => account.user === mysqlUser)

if (!rootAccounts.length) {
  fail('no root accounts found in mysql.user')
}

if (!appAccounts.length) {
  fail('no MYSQL_USER accounts found in mysql.user')
}

const statements = []
for (const account of appAccounts) {
  statements.push(
    `ALTER USER ${sqlAccount(account.user, account.host)} IDENTIFIED BY ${sqlString(nextSecrets.get('MYSQL_PASSWORD'))};`
  )
}

for (const account of rootAccounts) {
  statements.push(
    `ALTER USER ${sqlAccount(account.user, account.host)} IDENTIFIED BY ${sqlString(nextSecrets.get('MYSQL_ROOT_PASSWORD'))};`
  )
}

statements.push('FLUSH PRIVILEGES;')
runMysql(`${statements.join('\n')}\n`)

const nextEnv = renderEnv(lines, nextSecrets)
fs.writeFileSync(envPath, nextEnv, { encoding: 'utf8', mode: 0o600 })

console.log(`rotated_keys=${secretKeys.join(',')}`)
console.log(`mysql_accounts_rotated=root:${rootAccounts.length},${mysqlUser}:${appAccounts.length}`)
console.log('env_updated=ops/production/.env.prod')
