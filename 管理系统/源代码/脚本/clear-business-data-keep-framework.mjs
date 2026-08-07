import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import mysql from 'mysql2/promise'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

dotenv.config({ path: path.join(projectRoot, '.env'), quiet: true })
dotenv.config({ path: path.join(projectRoot, '运维/生产配置/.env.prod'), override: true, quiet: true })

const apply = process.argv.includes('--apply')

const dbConfig = {
  host: process.env.MYSQL_AUDIT_HOST || process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_AUDIT_PORT || process.env.MYSQL_HOST_PORT || process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_AUDIT_USER || process.env.MYSQL_USER || 'cattle_user',
  password: process.env.MYSQL_AUDIT_PASSWORD || process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_AUDIT_DATABASE || process.env.MYSQL_DATABASE || 'cattle_management'
}

const CLEAR_TABLES = [
  'animal',
  'cows',
  'animal_identifier',
  'animal_parentage',
  'animal_pen_assignment',
  'parity_episode',
  'lactation_episode',
  'gestation_episode',
  'dry_period_episode',
  'reproduction_cycle',
  'reproduction_cycles',
  'fact_lactation_305',
  'milk_measurement',
  'milk_records',
  'milking_session',
  'milking_visit',
  'lactation_curves',
  'data_quality_issue',
  'trait_observation',
  'trait_observation_batch',
  'phenotype_records',
  'animal_event',
  'cow_events',
  'entry_events',
  'transfer_events',
  'exit_events',
  'breeding_events',
  'veterinary_events',
  'event_movement_detail',
  'event_reproduction_detail',
  'event_reproduction_calf',
  'event_health_detail',
  'event_medicine_detail',
  'event_production_detail',
  'derivation_recompute_job',
  'sensor_reading',
  'sensor_readings',
  'sensor_status',
  'sensors',
  'sensor_calibrations',
  'animal_device_assignment',
  'device_channel',
  'alerts',
  'predictive_alerts',
  'hardware_alerts',
  'health_scores',
  'feed_records',
  'feed_inventory',
  'breeding_records',
  'omics_samples',
  'omics_datasets',
  'omics_markers',
  'omics_trait_link',
  'multi_omics_associations',
  'omics_module_runs',
  'omics_workflow_runs',
  'omics_analysis_artifacts',
  'breeding_analyses',
  'breeding_value_runs',
  'breeding_value_results',
  'breeding_value_values',
  'breeding_decision_runs',
  'predictive_models',
  'prediction_results',
  'forecast_scenarios',
  'data_quality_checks',
  'data_synchronizations',
  'device_maintenance',
  'hardware_command_logs',
  'workflow_instances',
  'automated_actions',
  'smart_transfer_rules',
  'reminder_rules',
  'kpi_dashboard_data',
  'kpi_data',
  'economic_analysis',
  'economic_data',
  'cost_items',
  'revenue_items',
  'budget_plans',
  'export_audit_logs',
  'operation_audit_log',
  'operation_audit_logs'
]

const KEEP_TABLES = [
  'users',
  'user',
  'roles',
  'role',
  'permissions',
  'persons',
  'base_info_categories',
  'base_info_category',
  'custom_fields',
  'import_configs',
  'export_configs',
  'farm_unit',
  'pens',
  'trait_category',
  'trait_definition',
  'breed_types',
  'breed-types',
  'medicines',
  'medicine',
  'medicine_batch',
  'devices',
  'device',
  'hardware_devices',
  'business_calendar'
]

async function tableExists(connection, table) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS count
       FROM information_schema.tables
      WHERE table_schema = ? AND table_name = ? AND table_type = 'BASE TABLE'`,
    [dbConfig.database, table]
  )
  return Number(rows?.[0]?.count || 0) > 0
}

async function countRows(connection, table) {
  if (!(await tableExists(connection, table))) return null
  const [rows] = await connection.query(`SELECT COUNT(*) AS count FROM \`${table}\``)
  return Number(rows?.[0]?.count || 0)
}

async function existingTables(connection, tables) {
  const result = []
  for (const table of [...new Set(tables)]) {
    if (await tableExists(connection, table)) result.push(table)
  }
  return result
}

async function countTableGroup(connection, tables) {
  const result = {}
  for (const table of [...new Set(tables)]) result[table] = await countRows(connection, table)
  return result
}

async function main() {
  const connection = await mysql.createConnection(dbConfig)
  try {
    const clearTables = await existingTables(connection, CLEAR_TABLES)
    const keepTables = await existingTables(connection, KEEP_TABLES)
    const beforeClear = await countTableGroup(connection, clearTables)
    const beforeKeep = await countTableGroup(connection, keepTables)

    if (apply) {
      await connection.beginTransaction()
      await connection.query('SET FOREIGN_KEY_CHECKS = 0')
      try {
        for (const table of clearTables) {
          if (beforeClear[table] > 0) await connection.query(`DELETE FROM \`${table}\``)
        }
        await connection.query('SET FOREIGN_KEY_CHECKS = 1')
        await connection.commit()
      } catch (error) {
        await connection.query('SET FOREIGN_KEY_CHECKS = 1').catch(() => undefined)
        await connection.rollback().catch(() => undefined)
        throw error
      }
    }

    const afterClear = await countTableGroup(connection, clearTables)
    const afterKeep = await countTableGroup(connection, keepTables)
    const deleted = Object.fromEntries(
      clearTables.map((table) => [table, apply ? beforeClear[table] - afterClear[table] : 0])
    )
    const wouldDelete = Object.fromEntries(
      clearTables.map((table) => [table, apply ? undefined : beforeClear[table]])
    )

    console.log(
      JSON.stringify(
        {
          mode: apply ? 'apply' : 'dry-run',
          database: `${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`,
          policy:
            'clear business facts only; keep schema, accounts, persons, dictionaries, import configs, farm units, pens, trait definitions and platform configuration',
          clearTables,
          keepTables,
          beforeClear,
          deleted,
          wouldDelete: apply ? undefined : wouldDelete,
          afterClear,
          beforeKeep,
          afterKeep
        },
        null,
        2
      )
    )
  } finally {
    await connection.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
