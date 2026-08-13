-- MySQL 8.x bootstrap schema for cattle management
-- Charset/Collation: utf8mb4 / utf8mb4_0900_ai_ci

-- skipped create database for restricted user

USE niushuju;

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS cows (
  id VARCHAR(64) PRIMARY KEY,
  cow_number VARCHAR(64) NOT NULL,
  ear_tag_number VARCHAR(64) NULL,
  father_number VARCHAR(64) NULL,
  mother_number VARCHAR(64) NULL,
  grandfather_number VARCHAR(64) NULL,
  grandmother_number VARCHAR(64) NULL,
  breed VARCHAR(64) NOT NULL,
  gender VARCHAR(16) NOT NULL,
  birth_date DATE NULL,
  cow_type VARCHAR(32) NULL,
  current_pen VARCHAR(128) NULL,
  status VARCHAR(32) NOT NULL,
  pregnancy TINYINT(1) NOT NULL DEFAULT 0,
  mixing TINYINT(1) NOT NULL DEFAULT 0,
  parity INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_cows_cow_number (cow_number),
  UNIQUE KEY uk_cows_ear_tag_number (ear_tag_number),
  KEY idx_cows_status (status),
  KEY idx_cows_breed (breed),
  KEY idx_cows_gender (gender),
  KEY idx_cows_current_pen (current_pen),
  KEY idx_cows_birth_date (birth_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS sensors (
  id VARCHAR(64) PRIMARY KEY,
  cow_id VARCHAR(64) NOT NULL,
  ts DATETIME(3) NOT NULL,
  temperature DECIMAL(6,2) NULL,
  steps INT NULL,
  rumination JSON NULL,
  activity JSON NULL,
  feeding JSON NULL,
  vital_signs JSON NULL,
  environment JSON NULL,
  payload JSON NULL,
  created_at DATETIME(3) NULL,
  KEY idx_sensors_cow_id (cow_id),
  KEY idx_sensors_ts (ts),
  KEY idx_sensors_cow_ts (cow_id, ts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS persons (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  department VARCHAR(128) NULL,
  role VARCHAR(64) NOT NULL,
  phone VARCHAR(32) NULL,
  email VARCHAR(128) NULL,
  status VARCHAR(32) NULL,
  hire_date DATE NULL,
  notes TEXT NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  KEY idx_persons_name (name),
  KEY idx_persons_department (department)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS pens (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  category VARCHAR(64) NOT NULL,
  capacity INT NULL,
  area DECIMAL(12,2) NULL,
  manager VARCHAR(128) NULL,
  status VARCHAR(32) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  UNIQUE KEY uk_pens_name (name),
  KEY idx_pens_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS diseases (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  category VARCHAR(64) NULL,
  severity VARCHAR(32) NULL,
  contagious TINYINT(1) NOT NULL DEFAULT 0,
  symptoms TEXT NULL,
  treatment TEXT NULL,
  status VARCHAR(32) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  KEY idx_diseases_name (name),
  KEY idx_diseases_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS medicines (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  category VARCHAR(64) NULL,
  dosage VARCHAR(128) NULL,
  unit VARCHAR(32) NULL,
  usage_text TEXT NULL,
  storage VARCHAR(256) NULL,
  status VARCHAR(32) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  KEY idx_medicines_name (name),
  KEY idx_medicines_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS transfer_reasons (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128) NULL,
  reason VARCHAR(128) NULL,
  category_id VARCHAR(64) NULL,
  category_name VARCHAR(128) NULL,
  category VARCHAR(128) NULL,
  frequency VARCHAR(32) NULL,
  status VARCHAR(32) NULL,
  description TEXT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  KEY idx_transfer_reasons_name (name),
  KEY idx_transfer_reasons_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS breed_types (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  category VARCHAR(64) NULL,
  origin VARCHAR(128) NULL,
  description TEXT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  UNIQUE KEY uk_breed_types_name (name),
  KEY idx_breed_types_category (category),
  KEY idx_breed_types_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS milk_records (
  id VARCHAR(64) PRIMARY KEY,
  cow_id VARCHAR(64) NOT NULL,
  milking_time DATETIME(3) NOT NULL,
  volume DECIMAL(10,2) NULL,
  milk_quality JSON NULL,
  milking_method VARCHAR(32) NULL,
  milker_id VARCHAR(64) NULL,
  equipment_id VARCHAR(64) NULL,
  reported_age_months DECIMAL(10,2) NULL,
  reported_lactation_month INT NULL,
  notes TEXT NULL,
  created_at DATETIME(3) NULL,
  KEY idx_milk_records_cow_id (cow_id),
  KEY idx_milk_records_milking_time (milking_time),
  KEY idx_milk_records_cow_milking_time (cow_id, milking_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS milk_quality_standards (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  standard_json JSON NULL,
  description TEXT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  KEY idx_mqs_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS lactation_curves (
  id VARCHAR(64) PRIMARY KEY,
  cow_id VARCHAR(64) NOT NULL,
  day_no INT NULL,
  curve_json JSON NULL,
  created_at DATETIME(3) NULL,
  KEY idx_lactation_curves_cow_id (cow_id),
  KEY idx_lactation_curves_cow_day (cow_id, day_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS feed_records (
  id VARCHAR(64) PRIMARY KEY,
  cow_id VARCHAR(64) NULL,
  pen_id VARCHAR(64) NULL,
  formula_id VARCHAR(64) NULL,
  feed_time DATETIME(3) NULL,
  planned_amount DECIMAL(10,2) NULL,
  actual_amount DECIMAL(10,2) NULL,
  feeder_id VARCHAR(64) NULL,
  feed_quality JSON NULL,
  notes TEXT NULL,
  created_at DATETIME(3) NULL,
  KEY idx_feed_records_cow_id (cow_id),
  KEY idx_feed_records_feed_time (feed_time),
  KEY idx_feed_records_cow_feed_time (cow_id, feed_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS feed_formulas (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  target_group VARCHAR(64) NULL,
  description TEXT NULL,
  nutritional_content JSON NULL,
  ingredients JSON NULL,
  total_cost DECIMAL(12,2) NULL,
  expected_production DECIMAL(12,2) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NULL,
  KEY idx_feed_formulas_name (name),
  KEY idx_feed_formulas_target_group (target_group)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS feed_inventory (
  id VARCHAR(64) PRIMARY KEY,
  feed_type VARCHAR(64) NULL,
  feed_id VARCHAR(64) NULL,
  feed_name VARCHAR(128) NULL,
  current_stock DECIMAL(12,2) NULL,
  minimum_stock DECIMAL(12,2) NULL,
  unit_cost DECIMAL(12,2) NULL,
  supplier VARCHAR(128) NULL,
  expiry_date DATE NULL,
  quality_grade VARCHAR(8) NULL,
  last_updated DATETIME(3) NULL,
  KEY idx_feed_inventory_feed_type (feed_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS breeding_records (
  id VARCHAR(64) PRIMARY KEY,
  cow_id VARCHAR(64) NOT NULL,
  event_time DATETIME(3) NOT NULL,
  event_type VARCHAR(64) NULL,
  payload JSON NULL,
  created_at DATETIME(3) NULL,
  KEY idx_breeding_records_cow_id (cow_id),
  KEY idx_breeding_records_event_time (event_time),
  KEY idx_breeding_records_cow_event_time (cow_id, event_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS reproduction_cycles (
  id VARCHAR(64) PRIMARY KEY,
  cow_id VARCHAR(64) NOT NULL,
  cycle_start DATETIME(3) NULL,
  payload JSON NULL,
  created_at DATETIME(3) NULL,
  KEY idx_reproduction_cycles_cow_id (cow_id),
  KEY idx_reproduction_cycles_cow_cycle_start (cow_id, cycle_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS alerts (
  id VARCHAR(64) PRIMARY KEY,
  cow_id VARCHAR(64) NOT NULL,
  alert_time DATETIME(3) NULL,
  severity VARCHAR(16) NULL,
  alert_type VARCHAR(64) NULL,
  title VARCHAR(255) NULL,
  description TEXT NULL,
  status VARCHAR(32) NULL,
  payload JSON NULL,
  created_at DATETIME(3) NULL,
  KEY idx_alerts_cow_id (cow_id),
  KEY idx_alerts_alert_time (alert_time),
  KEY idx_alerts_severity (severity),
  KEY idx_alerts_cow_alert_time (cow_id, alert_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS workflow_templates (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  category VARCHAR(64) NULL,
  trigger_type VARCHAR(64) NULL,
  priority VARCHAR(32) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  description TEXT NULL,
  trigger_condition JSON NULL,
  steps JSON NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  KEY idx_workflow_templates_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS workflow_instances (
  id VARCHAR(64) PRIMARY KEY,
  template_id VARCHAR(64) NOT NULL,
  cow_id VARCHAR(64) NULL,
  status VARCHAR(32) NULL,
  current_step VARCHAR(64) NULL,
  step_status JSON NULL,
  variables JSON NULL,
  trigger_event JSON NULL,
  started_at DATETIME(3) NULL,
  completed_at DATETIME(3) NULL,
  created_at DATETIME(3) NULL,
  KEY idx_workflow_instances_template_id (template_id),
  KEY idx_workflow_instances_status (status),
  KEY idx_workflow_instances_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS automated_actions (
  id VARCHAR(64) PRIMARY KEY,
  workflow_instance_id VARCHAR(64) NULL,
  name VARCHAR(128) NULL,
  action_type VARCHAR(64) NULL,
  status VARCHAR(32) NULL,
  trigger_condition JSON NULL,
  target_config JSON NULL,
  execution_count INT NOT NULL DEFAULT 0,
  success_rate DECIMAL(5,2) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  last_executed DATETIME(3) NULL,
  created_at DATETIME(3) NULL,
  KEY idx_automated_actions_workflow_instance_id (workflow_instance_id),
  KEY idx_automated_actions_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS smart_transfer_rules (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  trigger_condition JSON NULL,
  source_pens JSON NULL,
  target_pen VARCHAR(128) NULL,
  transfer_reason VARCHAR(128) NULL,
  execution_count INT NOT NULL DEFAULT 0,
  last_executed DATETIME(3) NULL,
  created_at DATETIME(3) NULL,
  KEY idx_str_name (name),
  KEY idx_str_enabled (enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS reminder_rules (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  reminder_type VARCHAR(64) NULL,
  target_condition JSON NULL,
  schedule_json JSON NULL,
  notification JSON NULL,
  actions_json JSON NULL,
  last_triggered DATETIME(3) NULL,
  trigger_count INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NULL,
  KEY idx_rr_name (name),
  KEY idx_rr_enabled (enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS kpi_dashboards (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  category VARCHAR(64) NULL,
  description TEXT NULL,
  metrics JSON NULL,
  layout_json JSON NULL,
  is_public TINYINT(1) NOT NULL DEFAULT 0,
  created_by VARCHAR(64) NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  KEY idx_kpi_dashboards_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS kpi_dashboard_data (
  id VARCHAR(64) PRIMARY KEY,
  dashboard_id VARCHAR(64) NOT NULL,
  ts DATETIME(3) NOT NULL,
  cow_ids JSON NULL,
  relation_scope JSON NULL,
  source_record_ids JSON NULL,
  payload JSON NULL,
  KEY idx_kdd_dashboard_id (dashboard_id),
  KEY idx_kdd_ts (ts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS economic_analysis (
  id VARCHAR(64) PRIMARY KEY,
  period VARCHAR(64) NULL,
  analysis_type VARCHAR(32) NULL,
  cow_ids JSON NULL,
  relation_scope JSON NULL,
  source_record_ids JSON NULL,
  payload JSON NULL,
  created_at DATETIME(3) NULL,
  KEY idx_ea_period (period),
  KEY idx_ea_period_type (period, analysis_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS cost_items (
  id VARCHAR(64) PRIMARY KEY,
  category VARCHAR(64) NULL,
  name VARCHAR(128) NULL,
  amount DECIMAL(12,2) NULL,
  unit VARCHAR(32) NULL,
  item_date DATE NULL,
  cow_id VARCHAR(64) NULL,
  cow_ids JSON NULL,
  relation_scope JSON NULL,
  source_record_ids JSON NULL,
  description TEXT NULL,
  created_at DATETIME(3) NULL,
  KEY idx_cost_items_date (item_date),
  KEY idx_cost_items_category (category),
  KEY idx_cost_items_date_category (item_date, category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS revenue_items (
  id VARCHAR(64) PRIMARY KEY,
  category VARCHAR(64) NULL,
  name VARCHAR(128) NULL,
  amount DECIMAL(12,2) NULL,
  unit VARCHAR(32) NULL,
  quantity DECIMAL(12,2) NULL,
  unit_price DECIMAL(12,2) NULL,
  item_date DATE NULL,
  cow_id VARCHAR(64) NULL,
  cow_ids JSON NULL,
  relation_scope JSON NULL,
  source_record_ids JSON NULL,
  description TEXT NULL,
  created_at DATETIME(3) NULL,
  KEY idx_revenue_items_date (item_date),
  KEY idx_revenue_items_category (category),
  KEY idx_revenue_items_date_category (item_date, category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS budget_plans (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128) NULL,
  period VARCHAR(64) NULL,
  status VARCHAR(32) NULL,
  budget_items JSON NULL,
  cow_ids JSON NULL,
  relation_scope JSON NULL,
  source_record_ids JSON NULL,
  total_planned DECIMAL(12,2) NULL,
  total_actual DECIMAL(12,2) NULL,
  created_by VARCHAR(64) NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  KEY idx_budget_plans_period (period),
  KEY idx_budget_plans_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS phenotype_trait_definitions (
  id VARCHAR(64) PRIMARY KEY,
  code VARCHAR(128) NOT NULL,
  name VARCHAR(128) NOT NULL,
  category VARCHAR(64) NOT NULL,
  unit VARCHAR(64) NULL,
  data_type VARCHAR(32) NOT NULL DEFAULT '数值',
  source VARCHAR(64) NOT NULL DEFAULT '人工采集',
  required_fields TEXT NULL,
  linked_domains TEXT NULL,
  status VARCHAR(32) NOT NULL DEFAULT '启用',
  description TEXT NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  UNIQUE KEY uk_phenotype_trait_code (code),
  KEY idx_phenotype_trait_category (category),
  KEY idx_phenotype_trait_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS phenotype_records (
  id VARCHAR(128) PRIMARY KEY,
  cow_id VARCHAR(64) NOT NULL,
  cow_number VARCHAR(64) NULL,
  collection_date DATETIME(3) NOT NULL,
  trait_code VARCHAR(128) NOT NULL,
  trait_name VARCHAR(128) NULL,
  category VARCHAR(64) NULL,
  value DECIMAL(16,4) NULL,
  text_value TEXT NULL,
  unit VARCHAR(64) NULL,
  source VARCHAR(64) NULL,
  collector VARCHAR(128) NULL,
  data_source VARCHAR(32) NOT NULL DEFAULT 'real',
  pedigree_linked TINYINT(1) NOT NULL DEFAULT 0,
  omics_linked TINYINT(1) NOT NULL DEFAULT 0,
  raw_payload JSON NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  KEY idx_phenotype_records_cow_id (cow_id),
  KEY idx_phenotype_records_trait_code (trait_code),
  KEY idx_phenotype_records_collection_date (collection_date),
  KEY idx_phenotype_records_cow_trait_date (cow_id, trait_code, collection_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS predictive_models (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  model_type VARCHAR(64) NULL,
  status VARCHAR(32) NULL,
  description TEXT NULL,
  algorithm VARCHAR(64) NULL,
  target_variable VARCHAR(128) NULL,
  feature_variables JSON NULL,
  training_data JSON NULL,
  performance JSON NULL,
  last_trained DATETIME(3) NULL,
  next_training DATETIME(3) NULL,
  created_at DATETIME(3) NULL,
  KEY idx_predictive_models_name (name),
  KEY idx_predictive_models_type (model_type),
  KEY idx_predictive_models_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS prediction_results (
  id VARCHAR(64) PRIMARY KEY,
  model_id VARCHAR(64) NOT NULL,
  ts DATETIME(3) NOT NULL,
  target_date DATE NULL,
  predicted_value DECIMAL(14,4) NULL,
  confidence_interval JSON NULL,
  actual_value DECIMAL(14,4) NULL,
  accuracy DECIMAL(8,4) NULL,
  factors JSON NULL,
  generated_at DATETIME(3) NULL,
  KEY idx_prediction_results_model_id (model_id),
  KEY idx_prediction_results_ts (ts),
  KEY idx_prediction_results_model_ts (model_id, ts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS forecast_scenarios (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  base_date DATE NULL,
  description TEXT NULL,
  time_horizon INT NULL,
  assumptions JSON NULL,
  results JSON NULL,
  risk_level VARCHAR(32) NULL,
  recommendations JSON NULL,
  created_at DATETIME(3) NULL,
  KEY idx_forecast_scenarios_name (name),
  KEY idx_forecast_scenarios_base_date (base_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS predictive_alerts (
  id VARCHAR(64) PRIMARY KEY,
  model_id VARCHAR(64) NULL,
  cow_id VARCHAR(64) NULL,
  alert_time DATETIME(3) NULL,
  alert_type VARCHAR(64) NULL,
  severity VARCHAR(16) NULL,
  title VARCHAR(255) NULL,
  description TEXT NULL,
  status VARCHAR(32) NULL,
  predicted_date DATE NULL,
  probability DECIMAL(8,4) NULL,
  cow_ids JSON NULL,
  relation_scope JSON NULL,
  source_record_ids JSON NULL,
  impact_json JSON NULL,
  recommendations JSON NULL,
  created_at DATETIME(3) NULL,
  acknowledged_at DATETIME(3) NULL,
  resolved_at DATETIME(3) NULL,
  KEY idx_predictive_alerts_cow_id (cow_id),
  KEY idx_predictive_alerts_model_id (model_id),
  KEY idx_predictive_alerts_alert_time (alert_time),
  KEY idx_predictive_alerts_severity (severity)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS sensor_status (
  id VARCHAR(64) PRIMARY KEY,
  device_id VARCHAR(64) NULL,
  cow_id VARCHAR(64) NULL,
  ts DATETIME(3) NULL,
  sensor_id VARCHAR(64) NULL,
  battery_level DECIMAL(6,2) NULL,
  signal_strength DECIMAL(6,2) NULL,
  status VARCHAR(32) NULL,
  payload JSON NULL,
  KEY idx_sensor_status_device_id (device_id),
  KEY idx_sensor_status_ts (ts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS data_quality_checks (
  id VARCHAR(64) PRIMARY KEY,
  check_time DATETIME(3) NULL,
  status VARCHAR(32) NULL,
  cow_id VARCHAR(64) NULL,
  data_type VARCHAR(64) NULL,
  original_value DECIMAL(14,4) NULL,
  quality_score DECIMAL(6,2) NULL,
  is_valid TINYINT(1) NOT NULL DEFAULT 1,
  issues JSON NULL,
  corrected_value DECIMAL(14,4) NULL,
  correction_method VARCHAR(128) NULL,
  KEY idx_dqc_check_time (check_time),
  KEY idx_dqc_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS sensor_calibrations (
  id VARCHAR(64) PRIMARY KEY,
  device_id VARCHAR(64) NULL,
  sensor_id VARCHAR(64) NULL,
  calibration_time DATETIME(3) NULL,
  calibration_type VARCHAR(64) NULL,
  parameters_json JSON NULL,
  cow_ids JSON NULL,
  relation_scope JSON NULL,
  source_record_ids JSON NULL,
  valid_until DATETIME(3) NULL,
  accuracy DECIMAL(8,4) NULL,
  technician VARCHAR(128) NULL,
  KEY idx_sensor_calibrations_device_id (device_id),
  KEY idx_sensor_calibrations_calibration_time (calibration_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS hardware_devices (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  device_type VARCHAR(64) NULL,
  status VARCHAR(32) NULL,
  brand VARCHAR(64) NULL,
  model VARCHAR(64) NULL,
  serial_number VARCHAR(128) NULL,
  location_json JSON NULL,
  last_seen DATETIME(3) NULL,
  firmware_version VARCHAR(64) NULL,
  capabilities JSON NULL,
  configuration_json JSON NULL,
  cow_ids JSON NULL,
  relation_scope JSON NULL,
  source_record_ids JSON NULL,
  installed_at DATETIME(3) NULL,
  warranty_expiry DATE NULL,
  maintenance_schedule JSON NULL,
  KEY idx_hardware_devices_name (name),
  KEY idx_hardware_devices_type (device_type),
  KEY idx_hardware_devices_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS integration_protocols (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  protocol_type VARCHAR(64) NULL,
  version VARCHAR(32) NULL,
  description TEXT NULL,
  endpoints JSON NULL,
  data_format VARCHAR(32) NULL,
  supported_devices JSON NULL,
  cow_ids JSON NULL,
  relation_scope JSON NULL,
  source_record_ids JSON NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  last_used DATETIME(3) NULL,
  success_rate DECIMAL(5,2) NULL,
  KEY idx_integration_protocols_name (name),
  KEY idx_integration_protocols_type (protocol_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS data_synchronizations (
  id VARCHAR(64) PRIMARY KEY,
  protocol_id VARCHAR(64) NULL,
  sync_time DATETIME(3) NULL,
  source_device VARCHAR(128) NULL,
  target_system VARCHAR(128) NULL,
  data_type VARCHAR(64) NULL,
  sync_frequency VARCHAR(32) NULL,
  last_sync DATETIME(3) NULL,
  next_sync DATETIME(3) NULL,
  status VARCHAR(32) NULL,
  records_processed INT NULL,
  success_rate DECIMAL(5,2) NULL,
  error_count INT NULL,
  configuration_json JSON NULL,
  cow_ids JSON NULL,
  relation_scope JSON NULL,
  source_record_ids JSON NULL,
  KEY idx_data_sync_protocol_id (protocol_id),
  KEY idx_data_sync_status (status),
  KEY idx_data_sync_sync_time (sync_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS hardware_alerts (
  id VARCHAR(64) PRIMARY KEY,
  device_id VARCHAR(64) NULL,
  alert_time DATETIME(3) NULL,
  alert_type VARCHAR(64) NULL,
  severity VARCHAR(16) NULL,
  title VARCHAR(255) NULL,
  description TEXT NULL,
  status VARCHAR(32) NULL,
  detected_at DATETIME(3) NULL,
  resolved_at DATETIME(3) NULL,
  resolution TEXT NULL,
  auto_resolved TINYINT(1) NOT NULL DEFAULT 0,
  recommended_actions JSON NULL,
  affected_systems JSON NULL,
  cow_ids JSON NULL,
  relation_scope JSON NULL,
  source_record_ids JSON NULL,
  KEY idx_hardware_alerts_device_id (device_id),
  KEY idx_hardware_alerts_alert_time (alert_time),
  KEY idx_hardware_alerts_severity (severity)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS device_maintenance (
  id VARCHAR(64) PRIMARY KEY,
  device_id VARCHAR(64) NULL,
  maintenance_date DATETIME(3) NULL,
  status VARCHAR(32) NULL,
  maintenance_type VARCHAR(64) NULL,
  title VARCHAR(255) NULL,
  description TEXT NULL,
  scheduled_date DATETIME(3) NULL,
  completed_date DATETIME(3) NULL,
  technician VARCHAR(128) NULL,
  parts_used JSON NULL,
  labor_hours DECIMAL(10,2) NULL,
  total_cost DECIMAL(12,2) NULL,
  cow_ids JSON NULL,
  relation_scope JSON NULL,
  source_record_ids JSON NULL,
  priority VARCHAR(16) NULL,
  notes TEXT NULL,
  KEY idx_device_maintenance_device_id (device_id),
  KEY idx_device_maintenance_maintenance_date (maintenance_date),
  KEY idx_device_maintenance_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS integration_dashboards (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  description TEXT NULL,
  devices JSON NULL,
  alerts JSON NULL,
  sync_status JSON NULL,
  system_health JSON NULL,
  data_flow JSON NULL,
  cow_ids JSON NULL,
  relation_scope JSON NULL,
  source_record_ids JSON NULL,
  last_updated DATETIME(3) NULL,
  KEY idx_integration_dashboards_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS entry_events (
  id VARCHAR(64) PRIMARY KEY,
  cow_number VARCHAR(64) NOT NULL,
  entry_time DATETIME(3) NOT NULL,
  ear_tag_number VARCHAR(64) NULL,
  breed VARCHAR(64) NULL,
  gender VARCHAR(16) NULL,
  birth_date DATE NULL,
  reason VARCHAR(64) NULL,
  pen VARCHAR(128) NULL,
  recorder VARCHAR(128) NULL,
  notes TEXT NULL,
  created_at DATETIME(3) NULL,
  KEY idx_entry_events_cow_number (cow_number),
  KEY idx_entry_events_entry_time (entry_time),
  KEY idx_entry_events_cow_entry_time (cow_number, entry_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS transfer_events (
  id VARCHAR(64) PRIMARY KEY,
  cow_number VARCHAR(64) NOT NULL,
  transfer_time DATETIME(3) NOT NULL,
  reason VARCHAR(128) NULL,
  from_pen VARCHAR(128) NULL,
  to_pen VARCHAR(128) NULL,
  recorder VARCHAR(128) NULL,
  notes TEXT NULL,
  created_at DATETIME(3) NULL,
  KEY idx_transfer_events_cow_number (cow_number),
  KEY idx_transfer_events_transfer_time (transfer_time),
  KEY idx_transfer_events_cow_transfer_time (cow_number, transfer_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS exit_events (
  id VARCHAR(64) PRIMARY KEY,
  cow_number VARCHAR(64) NOT NULL,
  exit_time DATETIME(3) NOT NULL,
  reason VARCHAR(64) NULL,
  recorder VARCHAR(128) NULL,
  notes TEXT NULL,
  created_at DATETIME(3) NULL,
  KEY idx_exit_events_cow_number (cow_number),
  KEY idx_exit_events_exit_time (exit_time),
  KEY idx_exit_events_cow_exit_time (cow_number, exit_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS breeding_events (
  id VARCHAR(64) PRIMARY KEY,
  cow_number VARCHAR(64) NOT NULL,
  event_time DATETIME(3) NOT NULL,
  event_type VARCHAR(64) NULL,
  event_date DATE NULL,
  person VARCHAR(128) NULL,
  bull_number VARCHAR(64) NULL,
  semen_number VARCHAR(64) NULL,
  breeding_method VARCHAR(64) NULL,
  pregnancy_result VARCHAR(64) NULL,
  due_date DATE NULL,
  calving_result VARCHAR(64) NULL,
  delivery_result VARCHAR(64) NULL,
  offspring_count INT NULL,
  offspring_gender VARCHAR(64) NULL,
  offspring_status VARCHAR(64) NULL,
  abortion_reason VARCHAR(255) NULL,
  gestation_days INT NULL,
  notes TEXT NULL,
  created_at DATETIME(3) NULL,
  KEY idx_breeding_events_cow_number (cow_number),
  KEY idx_breeding_events_event_time (event_time),
  KEY idx_breeding_events_cow_event_time (cow_number, event_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS veterinary_events (
  id VARCHAR(64) PRIMARY KEY,
  cow_number VARCHAR(64) NOT NULL,
  event_time DATETIME(3) NOT NULL,
  event_type VARCHAR(64) NULL,
  event_date DATE NULL,
  person VARCHAR(128) NULL,
  disease VARCHAR(128) NULL,
  medicine VARCHAR(128) NULL,
  diagnosis_result VARCHAR(255) NULL,
  symptoms TEXT NULL,
  treatment_method VARCHAR(255) NULL,
  treatment_result VARCHAR(255) NULL,
  medication_name VARCHAR(255) NULL,
  dosage VARCHAR(64) NULL,
  vaccine_name VARCHAR(255) NULL,
  vaccine_batch VARCHAR(128) NULL,
  vaccine_dosage VARCHAR(64) NULL,
  next_vaccination_date DATE NULL,
  surgery_type VARCHAR(255) NULL,
  surgery_result VARCHAR(255) NULL,
  surgery_description TEXT NULL,
  examination_type VARCHAR(255) NULL,
  examination_result VARCHAR(255) NULL,
  examination_content TEXT NULL,
  cost DECIMAL(12,2) NULL,
  notes TEXT NULL,
  created_at DATETIME(3) NULL,
  KEY idx_veterinary_events_cow_number (cow_number),
  KEY idx_veterinary_events_event_time (event_time),
  KEY idx_veterinary_events_cow_event_time (cow_number, event_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
