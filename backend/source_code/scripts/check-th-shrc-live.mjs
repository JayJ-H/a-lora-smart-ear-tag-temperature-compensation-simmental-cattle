import assert from 'node:assert/strict'
import mqtt from 'mqtt'
import mysql from 'mysql2/promise'
import dotenv from 'dotenv'

dotenv.config()

const backendUrl = String(process.env.LOCAL_BACKEND_URL || 'http://127.0.0.1:9192').replace(/\/+$/, '')
const mqttHost = process.env.MQTT_TEST_HOST || '127.0.0.1'
const mqttPort = Number(process.env.MQTT_PORT || 9194)
const mqttUrl = process.env.TEST_MQTT_URL || `mqtt://${mqttHost}:${mqttPort}`
const cowNumber = String(process.env.TEST_MQTT_COW_NUMBER || '52')
const topic = process.env.TEST_MQTT_TOPIC || `cattle/${cowNumber}/temperature`
const messageId = process.env.TEST_MQTT_MESSAGE_ID || `th-shrc-live-${process.pid}-${Date.now()}`
const earTemperature = Number(process.env.TEST_MQTT_EAR_TEMPERATURE || 38.8)
const airTemperature = Number(process.env.TEST_MQTT_AIR_TEMPERATURE || 28)
// A clean MySQL volume may need the full backend schema pass before MQTT can be
// exercised. Keep the default aligned with the backend startup retry window.
const timeoutMs = Number(process.env.TEST_MQTT_TIMEOUT_MS || 120000)

const dbConfig = {
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT || process.env.MYSQL_HOST_PORT || 9193),
  user: process.env.MYSQL_USER || 'cattle_user',
  password: process.env.MYSQL_PASSWORD || 'local_database_password',
  database: process.env.MYSQL_DATABASE || 'cattle_management'
}

const payload = {
  messageId,
  cowNumber,
  timestamp: new Date().toISOString(),
  earTemperature,
  airTemperature,
  signalStrength: -61
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseJson(value) {
  if (value && typeof value === 'object') return value
  if (typeof value !== 'string' || !value.trim()) return {}
  try {
    return JSON.parse(value)
  } catch {
    return {}
  }
}

async function checkApi() {
  const response = await fetch(`${backendUrl}/api/health`)
  const body = await response.json()
  assert.equal(response.ok, true, `API health returned HTTP ${response.status}`)
  assert.ok([0, 200].includes(Number(body?.code)), 'API health did not return a success code')
  return body
}

async function waitForSchema() {
  const requiredColumns = {
    mqtt_message_logs: ['status', 'source_message_id', 'parsed_payload'],
    sensor_reading: ['metric_code', 'raw_payload', 'source_record_id']
  }
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    let connection
    try {
      connection = await mysql.createConnection(dbConfig)
      const [rows] = await connection.query(
        `
          SELECT table_name, column_name
          FROM information_schema.columns
          WHERE table_schema = ?
            AND table_name IN (?, ?)
        `,
        [dbConfig.database, ...Object.keys(requiredColumns)]
      )
      const present = new Map()
      for (const row of rows) {
        const table = String(row.table_name || row.TABLE_NAME || '')
        const column = String(row.column_name || row.COLUMN_NAME || '')
        if (!present.has(table)) present.set(table, new Set())
        present.get(table).add(column)
      }
      const ready = Object.entries(requiredColumns).every(([table, columns]) =>
        columns.every((column) => present.get(table)?.has(column))
      )
      if (ready) return
    } catch (error) {
      lastError = error
    } finally {
      await connection?.end().catch(() => undefined)
    }
    await sleep(500)
  }
  throw new Error(`Timed out waiting for backend schema: ${lastError?.message || 'not ready'}`)
}

function publish() {
  return new Promise((resolve, reject) => {
    const client = mqtt.connect(mqttUrl, {
      username: process.env.MQTT_USERNAME || undefined,
      password: process.env.MQTT_PASSWORD || undefined,
      reconnectPeriod: 0,
      connectTimeout: 5000,
      clientId: `th-shrc-check-${process.pid}-${Date.now()}`
    })
    let settled = false
    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      client.end(true)
      if (error) reject(error)
      else resolve()
    }
    const timer = setTimeout(() => finish(new Error(`MQTT publish timed out: ${mqttUrl}`)), 7000)
    client.on('connect', () => {
      client.publish(topic, JSON.stringify(payload), { qos: 1 }, (error) => finish(error || null))
    })
    client.on('error', (error) => finish(error))
  })
}

async function findPersistedRecord() {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    let connection
    try {
      connection = await mysql.createConnection(dbConfig)
      const [sensorRows] = await connection.query(
        `
          SELECT id, temperature, payload
          FROM sensors
          WHERE JSON_UNQUOTE(JSON_EXTRACT(payload, '$.sourceMessageId')) = ?
          LIMIT 1
        `,
        [messageId]
      )
      if (sensorRows.length) {
        const [readingRows] = await connection.query(
          `
            SELECT reading_value, raw_payload
            FROM sensor_reading
            WHERE JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.sourceMessageId')) = ?
              AND metric_code = 'body_temperature'
            ORDER BY id DESC
            LIMIT 1
          `,
          [messageId]
        )
        const [logRows] = await connection.query(
          `
            SELECT status, parsed_payload
            FROM mqtt_message_logs
            WHERE source_message_id = ?
            ORDER BY received_at DESC, id DESC
            LIMIT 1
          `,
          [messageId]
        )
        return {
          sensor: sensorRows[0],
          reading: readingRows[0] || null,
          log: logRows[0] || null
        }
      }
    } catch (error) {
      lastError = error
    } finally {
      await connection?.end().catch(() => undefined)
    }
    await sleep(500)
  }
  throw new Error(`Timed out waiting for persisted MQTT record: ${lastError?.message || 'not found'}`)
}

async function main() {
  await checkApi()
  await waitForSchema()
  await publish()
  const persisted = await findPersistedRecord()
  const sensorPayload = parseJson(persisted.sensor.payload)
  const compensation = parseJson(sensorPayload.compensation)
  const rawPayload = parseJson(persisted.reading?.raw_payload)
  const compensatedTemperature = Number(sensorPayload.compensatedTemperature)

  assert.ok(Number.isFinite(compensatedTemperature), 'Persisted sensor payload has no compensatedTemperature')
  assert.equal(compensation.model, 'TH-SHRC', 'Persisted compensation model is not TH-SHRC')
  assert.equal(compensation.modelVersion, 'th-shrc-runtime-v2-exact')
  assert.equal(Number(rawPayload.compensatedTemperature), compensatedTemperature)
  assert.equal(Number(persisted.reading?.reading_value), Number(persisted.sensor.temperature))
  assert.equal(persisted.log?.status, 'ingested', 'MQTT message log is not marked ingested')

  console.log(
    JSON.stringify(
      {
        status: 'PASS',
        messageId,
        mqtt: { url: mqttUrl, topic },
        input: { cowNumber, earTemperature, airTemperature },
        output: {
          compensatedTemperature,
          model: compensation.model,
          modelVersion: compensation.modelVersion,
          confidence: compensation.confidence,
          sensorTemperature: Number(persisted.sensor.temperature)
        },
        persistence: {
          sensorId: persisted.sensor.id,
          bodyTemperatureReading: Number(persisted.reading.reading_value),
          mqttLogStatus: persisted.log.status
        }
      },
      null,
      2
    )
  )
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status: 'FAIL',
        messageId,
        mqtt: { url: mqttUrl, topic },
        error: error?.message || String(error)
      },
      null,
      2
    )
  )
  process.exitCode = 1
})
