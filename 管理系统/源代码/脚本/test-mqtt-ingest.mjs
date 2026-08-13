import mqtt from 'mqtt'
import mysql from 'mysql2/promise'
import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const prodEnv = dotenv.config({ path: path.join(projectRoot, '运维/生产配置/.env.prod') }).parsed || {}

for (const key of ['MQTT_USERNAME', 'MQTT_PASSWORD']) {
  if (!process.env[key] && prodEnv[key]) {
    process.env[key] = prodEnv[key]
  }
}

const mqttUrl = process.env.TEST_MQTT_URL || `mqtt://127.0.0.1:${process.env.MQTT_PORT || 1883}`
const topic = process.env.TEST_MQTT_TOPIC || 'cattle/52/temperature'
const messageId = process.env.TEST_MQTT_MESSAGE_ID || `test-${Date.now()}`
const payload = {
  messageId,
  cowNumber: '52',
  timestamp: new Date().toISOString(),
  earTemperature: 38.8,
  rectalTemperature: 40.1,
  airTemperature: 35.8,
  signalStrength: 126
}

const dbConfig = {
  host: process.env.MYSQL_HOST || 'localhost',
  port: Number(process.env.MYSQL_PORT || 9193),
  user: process.env.MYSQL_USER || 'cattle_user',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'cattle_management'
}

function publish() {
  return new Promise((resolve, reject) => {
    const client = mqtt.connect(mqttUrl, {
      username: process.env.MQTT_USERNAME || undefined,
      password: process.env.MQTT_PASSWORD || undefined,
      reconnectPeriod: 0,
      connectTimeout: 5000
    })

    const timer = setTimeout(() => {
      client.end(true)
      reject(new Error(`MQTT publish timed out: ${mqttUrl}`))
    }, 7000)

    client.on('connect', () => {
      client.publish(topic, JSON.stringify(payload), { qos: 1 }, (error) => {
        clearTimeout(timer)
        client.end()
        if (error) reject(error)
        else resolve()
      })
    })

    client.on('error', (error) => {
      clearTimeout(timer)
      client.end(true)
      reject(error)
    })
  })
}

async function verify() {
  const connection = await mysql.createConnection(dbConfig)
  try {
    const [sensorRows] = await connection.query(
      `
        SELECT id, cow_id, ts, temperature, payload
        FROM sensors
        WHERE JSON_UNQUOTE(JSON_EXTRACT(payload, '$.sourceMessageId')) = ?
        LIMIT 1
      `,
      [messageId]
    )
    const [alertRows] = await connection.query(
      `
        SELECT id, severity, title, status, payload
        FROM alerts
        WHERE JSON_UNQUOTE(JSON_EXTRACT(payload, '$.sourceMessageId')) = ?
        LIMIT 1
      `,
      [messageId]
    )

    if (!sensorRows.length) throw new Error('No sensor row found for test MQTT message')
    if (!alertRows.length) throw new Error('No alert row found for test MQTT message')

    return {
      sensor: sensorRows[0],
      alert: alertRows[0]
    }
  } finally {
    await connection.end()
  }
}

async function main() {
  await publish()
  await new Promise((resolve) => setTimeout(resolve, 1200))
  const result = await verify()
  console.log(JSON.stringify({ ok: true, mqttUrl, topic, messageId, result }, null, 2))
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, mqttUrl, topic, messageId, error: error.message }, null, 2))
  process.exitCode = 1
})

