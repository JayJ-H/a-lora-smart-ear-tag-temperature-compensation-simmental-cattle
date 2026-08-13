-- 水牛育种平台 v2 数据库全量结构
-- MySQL 8 / InnoDB / utf8mb4

CREATE TABLE IF NOT EXISTS animal (
  id VARCHAR(64) NOT NULL,
  animal_number VARCHAR(64) NOT NULL,
  ear_tag_number VARCHAR(64) NULL,
  electronic_tag VARCHAR(64) NULL,
  name VARCHAR(128) NULL,
  species VARCHAR(64) NOT NULL DEFAULT '水牛',
  breed VARCHAR(128) NULL,
  sex VARCHAR(16) NOT NULL,
  birth_date DATE NULL,
  entry_date DATE NULL,
  source_farm VARCHAR(128) NULL,
  current_stage_id VARCHAR(64) NULL,
  current_group_id VARCHAR(64) NULL,
  current_unit_id VARCHAR(64) NULL,
  current_pen_id VARCHAR(64) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  genetic_line VARCHAR(128) NULL,
  production_purpose VARCHAR(64) NULL,
  reported_age_months DECIMAL(10,2) NULL,
  reported_lactation_month INT NULL,
  notes TEXT NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_animal_number (animal_number),
  KEY idx_animal_ear_tag (ear_tag_number),
  KEY idx_animal_status (status),
  KEY idx_animal_stage (current_stage_id),
  KEY idx_animal_group (current_group_id),
  KEY idx_animal_pen (current_pen_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS animal_identifier (
  id VARCHAR(64) NOT NULL,
  animal_id VARCHAR(64) NOT NULL,
  identifier_type VARCHAR(64) NOT NULL,
  identifier_value VARCHAR(128) NOT NULL,
  issuer VARCHAR(128) NULL,
  valid_from DATETIME(3) NULL,
  valid_to DATETIME(3) NULL,
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_animal_identifier (identifier_type, identifier_value),
  KEY idx_animal_identifier_animal (animal_id),
  CONSTRAINT fk_animal_identifier_animal FOREIGN KEY (animal_id) REFERENCES animal(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS animal_parentage (
  id VARCHAR(64) NOT NULL,
  animal_id VARCHAR(64) NOT NULL,
  parent_animal_id VARCHAR(64) NULL,
  parent_number VARCHAR(64) NULL,
  parent_role VARCHAR(16) NOT NULL,
  source_type VARCHAR(64) NULL,
  verification_method VARCHAR(64) NULL,
  confidence DECIMAL(6,4) NULL,
  effective_date DATE NULL,
  notes TEXT NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_animal_parent_role (animal_id, parent_role),
  KEY idx_animal_parentage_parent (parent_animal_id),
  KEY idx_animal_parentage_number (parent_number),
  CONSTRAINT fk_animal_parentage_animal FOREIGN KEY (animal_id) REFERENCES animal(id),
  CONSTRAINT fk_animal_parentage_parent FOREIGN KEY (parent_animal_id) REFERENCES animal(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stage_definition (
  id VARCHAR(64) NOT NULL,
  code VARCHAR(64) NOT NULL,
  name VARCHAR(128) NOT NULL,
  stage_type VARCHAR(64) NOT NULL,
  start_rule JSON NULL,
  end_rule JSON NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_stage_definition_code (code),
  KEY idx_stage_definition_type (stage_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS herd_group (
  id VARCHAR(64) NOT NULL,
  code VARCHAR(64) NOT NULL,
  name VARCHAR(128) NOT NULL,
  group_type VARCHAR(64) NOT NULL,
  stage_id VARCHAR(64) NULL,
  manager_id VARCHAR(64) NULL,
  purpose VARCHAR(128) NULL,
  selection_rule JSON NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_herd_group_code (code),
  KEY idx_herd_group_stage (stage_id),
  KEY idx_herd_group_type (group_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS farm_unit (
  id VARCHAR(64) NOT NULL,
  code VARCHAR(64) NOT NULL,
  name VARCHAR(128) NOT NULL,
  unit_type VARCHAR(64) NOT NULL,
  parent_unit_id VARCHAR(64) NULL,
  capacity INT NULL,
  location_label VARCHAR(128) NULL,
  environment_config JSON NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_farm_unit_code (code),
  KEY idx_farm_unit_parent (parent_unit_id),
  KEY idx_farm_unit_type (unit_type),
  CONSTRAINT fk_farm_unit_parent FOREIGN KEY (parent_unit_id) REFERENCES farm_unit(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS animal_group_membership (
  id VARCHAR(64) NOT NULL,
  animal_id VARCHAR(64) NOT NULL,
  group_id VARCHAR(64) NOT NULL,
  joined_at DATETIME(3) NOT NULL,
  left_at DATETIME(3) NULL,
  reason VARCHAR(128) NULL,
  operator_name VARCHAR(128) NULL,
  source_event_id VARCHAR(64) NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_group_membership_animal (animal_id, joined_at),
  KEY idx_group_membership_group (group_id, joined_at),
  KEY idx_group_membership_current (group_id, left_at),
  CONSTRAINT fk_group_membership_animal FOREIGN KEY (animal_id) REFERENCES animal(id),
  CONSTRAINT fk_group_membership_group FOREIGN KEY (group_id) REFERENCES herd_group(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS animal_pen_assignment (
  id VARCHAR(64) NOT NULL,
  animal_id VARCHAR(64) NOT NULL,
  unit_id VARCHAR(64) NOT NULL,
  assigned_at DATETIME(3) NOT NULL,
  released_at DATETIME(3) NULL,
  assignment_reason VARCHAR(128) NULL,
  operator_name VARCHAR(128) NULL,
  source_event_id VARCHAR(64) NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_pen_assignment_animal (animal_id, assigned_at),
  KEY idx_pen_assignment_unit (unit_id, assigned_at),
  KEY idx_pen_assignment_current (unit_id, released_at),
  CONSTRAINT fk_pen_assignment_animal FOREIGN KEY (animal_id) REFERENCES animal(id),
  CONSTRAINT fk_pen_assignment_unit FOREIGN KEY (unit_id) REFERENCES farm_unit(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS group_pen_policy (
  id VARCHAR(64) NOT NULL,
  group_id VARCHAR(64) NULL,
  stage_id VARCHAR(64) NULL,
  unit_id VARCHAR(64) NOT NULL,
  priority INT NOT NULL DEFAULT 0,
  capacity_limit INT NULL,
  effective_from DATETIME(3) NULL,
  effective_to DATETIME(3) NULL,
  policy_rule JSON NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_group_pen_policy_group (group_id),
  KEY idx_group_pen_policy_stage (stage_id),
  KEY idx_group_pen_policy_unit (unit_id),
  CONSTRAINT fk_group_pen_policy_group FOREIGN KEY (group_id) REFERENCES herd_group(id),
  CONSTRAINT fk_group_pen_policy_unit FOREIGN KEY (unit_id) REFERENCES farm_unit(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS group_transfer_request (
  id VARCHAR(64) NOT NULL,
  animal_id VARCHAR(64) NOT NULL,
  from_group_id VARCHAR(64) NULL,
  to_group_id VARCHAR(64) NULL,
  from_unit_id VARCHAR(64) NULL,
  to_unit_id VARCHAR(64) NULL,
  request_reason VARCHAR(256) NULL,
  request_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  requested_by VARCHAR(128) NULL,
  approved_by VARCHAR(128) NULL,
  executed_by VARCHAR(128) NULL,
  requested_at DATETIME(3) NULL,
  approved_at DATETIME(3) NULL,
  executed_at DATETIME(3) NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_transfer_request_animal (animal_id, requested_at),
  KEY idx_transfer_request_status (request_status),
  CONSTRAINT fk_transfer_request_animal FOREIGN KEY (animal_id) REFERENCES animal(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS unit_capacity_snapshot (
  id VARCHAR(64) NOT NULL,
  unit_id VARCHAR(64) NOT NULL,
  snapshot_date DATE NOT NULL,
  capacity INT NULL,
  animal_count INT NOT NULL DEFAULT 0,
  occupancy_rate DECIMAL(8,4) NULL,
  stage_distribution JSON NULL,
  group_distribution JSON NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_unit_capacity_snapshot (unit_id, snapshot_date),
  KEY idx_unit_capacity_date (snapshot_date),
  CONSTRAINT fk_unit_capacity_unit FOREIGN KEY (unit_id) REFERENCES farm_unit(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS business_calendar (
  id VARCHAR(64) NOT NULL,
  calendar_date DATE NOT NULL,
  production_date DATE NOT NULL,
  year_num INT NOT NULL,
  month_num INT NOT NULL,
  day_num INT NOT NULL,
  week_num INT NULL,
  is_workday TINYINT(1) NOT NULL DEFAULT 1,
  season_label VARCHAR(64) NULL,
  notes TEXT NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_business_calendar_date (calendar_date),
  KEY idx_business_calendar_production (production_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS production_day_rule (
  id VARCHAR(64) NOT NULL,
  code VARCHAR(64) NOT NULL,
  name VARCHAR(128) NOT NULL,
  day_start_time TIME NOT NULL DEFAULT '00:00:00',
  timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Shanghai',
  applies_to_unit_type VARCHAR(64) NULL,
  rule_config JSON NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_production_day_rule_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS production_shift (
  id VARCHAR(64) NOT NULL,
  code VARCHAR(64) NOT NULL,
  name VARCHAR(128) NOT NULL,
  shift_type VARCHAR(64) NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  sequence_no INT NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_production_shift_code (code),
  KEY idx_production_shift_type (shift_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS time_day (
  id VARCHAR(64) NOT NULL,
  day_date DATE NOT NULL,
  year_num INT NOT NULL,
  month_num INT NOT NULL,
  day_num INT NOT NULL,
  week_num INT NULL,
  quarter_num INT NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_time_day_date (day_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS time_month (
  id VARCHAR(64) NOT NULL,
  month_key VARCHAR(16) NOT NULL,
  year_num INT NOT NULL,
  month_num INT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_time_month_key (month_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS time_year (
  id VARCHAR(64) NOT NULL,
  year_num INT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_time_year_num (year_num)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS time_period (
  id VARCHAR(64) NOT NULL,
  period_type VARCHAR(64) NOT NULL,
  period_key VARCHAR(128) NOT NULL,
  animal_id VARCHAR(64) NULL,
  start_at DATETIME(3) NOT NULL,
  end_at DATETIME(3) NOT NULL,
  label VARCHAR(128) NULL,
  source_entity_type VARCHAR(64) NULL,
  source_entity_id VARCHAR(64) NULL,
  metadata JSON NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_time_period_key (period_type, period_key, animal_id),
  KEY idx_time_period_animal (animal_id, period_type, start_at),
  KEY idx_time_period_range (start_at, end_at),
  CONSTRAINT fk_time_period_animal FOREIGN KEY (animal_id) REFERENCES animal(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rolling_window_definition (
  id VARCHAR(64) NOT NULL,
  code VARCHAR(64) NOT NULL,
  name VARCHAR(128) NOT NULL,
  window_type VARCHAR(64) NOT NULL,
  window_size INT NULL,
  unit VARCHAR(32) NULL,
  anchor_rule JSON NULL,
  aggregation_rule JSON NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_rolling_window_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS animal_time_index (
  id VARCHAR(64) NOT NULL,
  animal_id VARCHAR(64) NOT NULL,
  period_id VARCHAR(64) NOT NULL,
  period_type VARCHAR(64) NOT NULL,
  period_key VARCHAR(128) NOT NULL,
  parity_no INT NULL,
  lactation_no INT NULL,
  reproduction_cycle_no INT NULL,
  days_in_milk INT NULL,
  days_pregnant INT NULL,
  group_id VARCHAR(64) NULL,
  unit_id VARCHAR(64) NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_animal_time_index (animal_id, period_id),
  KEY idx_animal_time_type (animal_id, period_type, period_key),
  KEY idx_animal_time_group (group_id, period_type),
  CONSTRAINT fk_animal_time_animal FOREIGN KEY (animal_id) REFERENCES animal(id),
  CONSTRAINT fk_animal_time_period FOREIGN KEY (period_id) REFERENCES time_period(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS trait_category (
  id VARCHAR(64) NOT NULL,
  code VARCHAR(64) NOT NULL,
  name VARCHAR(128) NOT NULL,
  parent_id VARCHAR(64) NULL,
  domain VARCHAR(64) NOT NULL DEFAULT 'phenotype',
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_trait_category_code (code),
  KEY idx_trait_category_parent (parent_id),
  CONSTRAINT fk_trait_category_parent FOREIGN KEY (parent_id) REFERENCES trait_category(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS trait_definition (
  id VARCHAR(64) NOT NULL,
  code VARCHAR(64) NOT NULL,
  name VARCHAR(128) NOT NULL,
  category_id VARCHAR(64) NULL,
  trait_type VARCHAR(64) NOT NULL,
  data_type VARCHAR(32) NOT NULL DEFAULT 'number',
  unit VARCHAR(32) NULL,
  value_min DECIMAL(18,6) NULL,
  value_max DECIMAL(18,6) NULL,
  is_quality_trait TINYINT(1) NOT NULL DEFAULT 0,
  applicable_stage_ids JSON NULL,
  default_aggregation VARCHAR(64) NULL,
  export_enabled TINYINT(1) NOT NULL DEFAULT 1,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_trait_definition_code (code),
  KEY idx_trait_definition_category (category_id),
  KEY idx_trait_definition_type (trait_type),
  CONSTRAINT fk_trait_definition_category FOREIGN KEY (category_id) REFERENCES trait_category(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS trait_method (
  id VARCHAR(64) NOT NULL,
  trait_id VARCHAR(64) NOT NULL,
  code VARCHAR(64) NOT NULL,
  name VARCHAR(128) NOT NULL,
  method_type VARCHAR(64) NOT NULL,
  device_type VARCHAR(64) NULL,
  protocol JSON NULL,
  precision_digits INT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_trait_method_code (trait_id, code),
  KEY idx_trait_method_type (method_type),
  CONSTRAINT fk_trait_method_trait FOREIGN KEY (trait_id) REFERENCES trait_definition(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS trait_observation_batch (
  id VARCHAR(64) NOT NULL,
  batch_code VARCHAR(64) NOT NULL,
  batch_name VARCHAR(128) NULL,
  trait_domain VARCHAR(64) NOT NULL DEFAULT 'phenotype',
  source_type VARCHAR(64) NOT NULL,
  source_unit_id VARCHAR(64) NULL,
  collector VARCHAR(128) NULL,
  collected_at DATETIME(3) NULL,
  qc_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  record_count INT NOT NULL DEFAULT 0,
  metadata JSON NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_trait_observation_batch_code (batch_code),
  KEY idx_trait_batch_source (source_type, collected_at),
  KEY idx_trait_batch_qc (qc_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS trait_observation (
  id VARCHAR(64) NOT NULL,
  animal_id VARCHAR(64) NOT NULL,
  trait_id VARCHAR(64) NOT NULL,
  method_id VARCHAR(64) NULL,
  batch_id VARCHAR(64) NULL,
  observed_at DATETIME(3) NOT NULL,
  production_date DATE NULL,
  shift_id VARCHAR(64) NULL,
  parity_no INT NULL,
  lactation_id VARCHAR(64) NULL,
  reproduction_cycle_id VARCHAR(64) NULL,
  numeric_value DECIMAL(18,6) NULL,
  text_value VARCHAR(512) NULL,
  json_value JSON NULL,
  unit VARCHAR(32) NULL,
  collector VARCHAR(128) NULL,
  source_type VARCHAR(64) NULL,
  source_record_id VARCHAR(64) NULL,
  quality_flag VARCHAR(32) NOT NULL DEFAULT 'valid',
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_trait_observation_animal_time (animal_id, observed_at),
  KEY idx_trait_observation_trait_time (trait_id, observed_at),
  KEY idx_trait_observation_batch (batch_id),
  KEY idx_trait_observation_period (animal_id, parity_no, production_date),
  CONSTRAINT fk_trait_observation_animal FOREIGN KEY (animal_id) REFERENCES animal(id),
  CONSTRAINT fk_trait_observation_trait FOREIGN KEY (trait_id) REFERENCES trait_definition(id),
  CONSTRAINT fk_trait_observation_method FOREIGN KEY (method_id) REFERENCES trait_method(id),
  CONSTRAINT fk_trait_observation_batch FOREIGN KEY (batch_id) REFERENCES trait_observation_batch(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS trait_aggregation_rule (
  id VARCHAR(64) NOT NULL,
  trait_id VARCHAR(64) NOT NULL,
  code VARCHAR(64) NOT NULL,
  name VARCHAR(128) NOT NULL,
  period_type VARCHAR(64) NOT NULL,
  aggregation_method VARCHAR(64) NOT NULL,
  filter_rule JSON NULL,
  output_unit VARCHAR(32) NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_trait_aggregation_rule (trait_id, code),
  KEY idx_trait_aggregation_period (period_type, aggregation_method),
  CONSTRAINT fk_trait_aggregation_trait FOREIGN KEY (trait_id) REFERENCES trait_definition(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fact_cow_trait_day (
  id VARCHAR(64) NOT NULL,
  animal_id VARCHAR(64) NOT NULL,
  trait_id VARCHAR(64) NOT NULL,
  day_date DATE NOT NULL,
  sample_count INT NOT NULL DEFAULT 0,
  min_value DECIMAL(18,6) NULL,
  max_value DECIMAL(18,6) NULL,
  avg_value DECIMAL(18,6) NULL,
  sum_value DECIMAL(18,6) NULL,
  `last_value` DECIMAL(18,6) NULL,
  quality_summary JSON NULL,
  recomputed_at DATETIME(3) NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_fact_trait_day (animal_id, trait_id, day_date),
  KEY idx_fact_trait_day_trait (trait_id, day_date),
  CONSTRAINT fk_fact_trait_day_animal FOREIGN KEY (animal_id) REFERENCES animal(id),
  CONSTRAINT fk_fact_trait_day_trait FOREIGN KEY (trait_id) REFERENCES trait_definition(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fact_cow_trait_month (
  id VARCHAR(64) NOT NULL,
  animal_id VARCHAR(64) NOT NULL,
  trait_id VARCHAR(64) NOT NULL,
  month_key VARCHAR(16) NOT NULL,
  sample_count INT NOT NULL DEFAULT 0,
  min_value DECIMAL(18,6) NULL,
  max_value DECIMAL(18,6) NULL,
  avg_value DECIMAL(18,6) NULL,
  sum_value DECIMAL(18,6) NULL,
  recomputed_at DATETIME(3) NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_fact_trait_month (animal_id, trait_id, month_key),
  KEY idx_fact_trait_month_trait (trait_id, month_key),
  CONSTRAINT fk_fact_trait_month_animal FOREIGN KEY (animal_id) REFERENCES animal(id),
  CONSTRAINT fk_fact_trait_month_trait FOREIGN KEY (trait_id) REFERENCES trait_definition(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fact_cow_trait_year (
  id VARCHAR(64) NOT NULL,
  animal_id VARCHAR(64) NOT NULL,
  trait_id VARCHAR(64) NOT NULL,
  year_num INT NOT NULL,
  sample_count INT NOT NULL DEFAULT 0,
  min_value DECIMAL(18,6) NULL,
  max_value DECIMAL(18,6) NULL,
  avg_value DECIMAL(18,6) NULL,
  sum_value DECIMAL(18,6) NULL,
  recomputed_at DATETIME(3) NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_fact_trait_year (animal_id, trait_id, year_num),
  KEY idx_fact_trait_year_trait (trait_id, year_num),
  CONSTRAINT fk_fact_trait_year_animal FOREIGN KEY (animal_id) REFERENCES animal(id),
  CONSTRAINT fk_fact_trait_year_trait FOREIGN KEY (trait_id) REFERENCES trait_definition(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fact_cow_trait_parity (
  id VARCHAR(64) NOT NULL,
  animal_id VARCHAR(64) NOT NULL,
  trait_id VARCHAR(64) NOT NULL,
  parity_no INT NOT NULL,
  sample_count INT NOT NULL DEFAULT 0,
  min_value DECIMAL(18,6) NULL,
  max_value DECIMAL(18,6) NULL,
  avg_value DECIMAL(18,6) NULL,
  sum_value DECIMAL(18,6) NULL,
  recomputed_at DATETIME(3) NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_fact_trait_parity (animal_id, trait_id, parity_no),
  KEY idx_fact_trait_parity_trait (trait_id, parity_no),
  CONSTRAINT fk_fact_trait_parity_animal FOREIGN KEY (animal_id) REFERENCES animal(id),
  CONSTRAINT fk_fact_trait_parity_trait FOREIGN KEY (trait_id) REFERENCES trait_definition(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fact_cow_trait_lactation (
  id VARCHAR(64) NOT NULL,
  animal_id VARCHAR(64) NOT NULL,
  trait_id VARCHAR(64) NOT NULL,
  lactation_id VARCHAR(64) NOT NULL,
  lactation_no INT NULL,
  sample_count INT NOT NULL DEFAULT 0,
  min_value DECIMAL(18,6) NULL,
  max_value DECIMAL(18,6) NULL,
  avg_value DECIMAL(18,6) NULL,
  sum_value DECIMAL(18,6) NULL,
  recomputed_at DATETIME(3) NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_fact_trait_lactation (animal_id, trait_id, lactation_id),
  KEY idx_fact_trait_lactation_trait (trait_id, lactation_no),
  CONSTRAINT fk_fact_trait_lactation_animal FOREIGN KEY (animal_id) REFERENCES animal(id),
  CONSTRAINT fk_fact_trait_lactation_trait FOREIGN KEY (trait_id) REFERENCES trait_definition(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fact_lactation_305 (
  id VARCHAR(64) NOT NULL,
  animal_id VARCHAR(64) NOT NULL,
  lactation_id VARCHAR(64) NOT NULL,
  parity_no INT NULL,
  start_date DATE NULL,
  end_date DATE NULL,
  milk_305 DECIMAL(18,6) NULL,
  fat_305 DECIMAL(18,6) NULL,
  protein_305 DECIMAL(18,6) NULL,
  record_days INT NULL,
  estimated_flag TINYINT(1) NOT NULL DEFAULT 0,
  method_code VARCHAR(64) NULL,
  recomputed_at DATETIME(3) NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_lactation_305 (animal_id, lactation_id),
  KEY idx_lactation_305_parity (parity_no),
  CONSTRAINT fk_lactation_305_animal FOREIGN KEY (animal_id) REFERENCES animal(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS animal_event (
  id VARCHAR(64) NOT NULL,
  animal_id VARCHAR(64) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  event_code VARCHAR(64) NULL,
  event_name VARCHAR(128) NULL,
  occurred_at DATETIME(3) NOT NULL,
  production_date DATE NULL,
  shift_id VARCHAR(64) NULL,
  parity_no INT NULL,
  lactation_id VARCHAR(64) NULL,
  reproduction_cycle_id VARCHAR(64) NULL,
  unit_id VARCHAR(64) NULL,
  operator_name VARCHAR(128) NULL,
  source_type VARCHAR(64) NULL,
  source_record_id VARCHAR(64) NULL,
  severity VARCHAR(32) NULL,
  event_status VARCHAR(32) NOT NULL DEFAULT 'recorded',
  notes TEXT NULL,
  custom_values JSON NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_animal_event_animal_time (animal_id, occurred_at),
  KEY idx_animal_event_type_time (event_type, occurred_at),
  KEY idx_animal_event_period (animal_id, parity_no, production_date),
  CONSTRAINT fk_animal_event_animal FOREIGN KEY (animal_id) REFERENCES animal(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS event_reproduction_detail (
  id VARCHAR(64) NOT NULL,
  event_id VARCHAR(64) NOT NULL,
  reproduction_action VARCHAR(64) NOT NULL,
  bull_animal_id VARCHAR(64) NULL,
  bull_number VARCHAR(64) NULL,
  semen_batch VARCHAR(128) NULL,
  insemination_no INT NULL,
  pregnancy_result VARCHAR(64) NULL,
  calving_result VARCHAR(64) NULL,
  calf_animal_id VARCHAR(64) NULL,
  technician VARCHAR(128) NULL,
  detail JSON NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_repro_detail_event (event_id),
  KEY idx_repro_detail_bull (bull_animal_id),
  CONSTRAINT fk_repro_detail_event FOREIGN KEY (event_id) REFERENCES animal_event(id),
  CONSTRAINT fk_repro_detail_bull FOREIGN KEY (bull_animal_id) REFERENCES animal(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS event_health_detail (
  id VARCHAR(64) NOT NULL,
  event_id VARCHAR(64) NOT NULL,
  diagnosis_code VARCHAR(64) NULL,
  diagnosis_name VARCHAR(128) NULL,
  symptom_summary TEXT NULL,
  body_temperature DECIMAL(8,3) NULL,
  veterinarian VARCHAR(128) NULL,
  treatment_plan TEXT NULL,
  recovery_status VARCHAR(64) NULL,
  detail JSON NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_health_detail_event (event_id),
  KEY idx_health_detail_diagnosis (diagnosis_code),
  CONSTRAINT fk_health_detail_event FOREIGN KEY (event_id) REFERENCES animal_event(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS event_movement_detail (
  id VARCHAR(64) NOT NULL,
  event_id VARCHAR(64) NOT NULL,
  from_group_id VARCHAR(64) NULL,
  to_group_id VARCHAR(64) NULL,
  from_unit_id VARCHAR(64) NULL,
  to_unit_id VARCHAR(64) NULL,
  movement_reason VARCHAR(256) NULL,
  approval_status VARCHAR(32) NULL,
  detail JSON NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_movement_detail_event (event_id),
  KEY idx_movement_detail_to_group (to_group_id),
  KEY idx_movement_detail_to_unit (to_unit_id),
  CONSTRAINT fk_movement_detail_event FOREIGN KEY (event_id) REFERENCES animal_event(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS event_production_detail (
  id VARCHAR(64) NOT NULL,
  event_id VARCHAR(64) NOT NULL,
  operation_type VARCHAR(64) NOT NULL,
  work_unit_id VARCHAR(64) NULL,
  production_batch VARCHAR(128) NULL,
  result_summary TEXT NULL,
  detail JSON NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_production_detail_event (event_id),
  KEY idx_production_detail_type (operation_type),
  CONSTRAINT fk_production_detail_event FOREIGN KEY (event_id) REFERENCES animal_event(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS event_medicine_detail (
  id VARCHAR(64) NOT NULL,
  event_id VARCHAR(64) NOT NULL,
  medicine_id VARCHAR(64) NULL,
  medicine_batch_id VARCHAR(64) NULL,
  dose DECIMAL(18,6) NULL,
  dose_unit VARCHAR(32) NULL,
  route VARCHAR(64) NULL,
  withdrawal_days INT NULL,
  detail JSON NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_event_medicine_event (event_id),
  KEY idx_event_medicine_medicine (medicine_id),
  CONSTRAINT fk_event_medicine_event FOREIGN KEY (event_id) REFERENCES animal_event(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS parity_episode (
  id VARCHAR(64) NOT NULL,
  animal_id VARCHAR(64) NOT NULL,
  parity_no INT NOT NULL,
  start_event_id VARCHAR(64) NULL,
  end_event_id VARCHAR(64) NULL,
  start_date DATE NULL,
  end_date DATE NULL,
  parity_status VARCHAR(32) NOT NULL DEFAULT 'open',
  outcome VARCHAR(64) NULL,
  notes TEXT NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_parity_episode (animal_id, parity_no),
  KEY idx_parity_episode_status (parity_status),
  CONSTRAINT fk_parity_episode_animal FOREIGN KEY (animal_id) REFERENCES animal(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reproduction_cycle (
  id VARCHAR(64) NOT NULL,
  animal_id VARCHAR(64) NOT NULL,
  cycle_no INT NOT NULL,
  parity_no INT NULL,
  started_at DATETIME(3) NULL,
  first_service_at DATETIME(3) NULL,
  last_service_at DATETIME(3) NULL,
  pregnancy_check_at DATETIME(3) NULL,
  expected_calving_date DATE NULL,
  actual_calving_at DATETIME(3) NULL,
  service_count INT NOT NULL DEFAULT 0,
  cycle_result VARCHAR(64) NULL,
  cycle_status VARCHAR(32) NOT NULL DEFAULT 'open',
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_reproduction_cycle (animal_id, cycle_no),
  KEY idx_reproduction_cycle_status (cycle_status),
  KEY idx_reproduction_cycle_parity (animal_id, parity_no),
  CONSTRAINT fk_reproduction_cycle_animal FOREIGN KEY (animal_id) REFERENCES animal(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lactation_episode (
  id VARCHAR(64) NOT NULL,
  animal_id VARCHAR(64) NOT NULL,
  lactation_no INT NOT NULL,
  parity_no INT NULL,
  calving_event_id VARCHAR(64) NULL,
  start_date DATE NOT NULL,
  dry_off_date DATE NULL,
  end_date DATE NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'open',
  days_in_milk INT NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_lactation_episode (animal_id, lactation_no),
  KEY idx_lactation_episode_status (status),
  CONSTRAINT fk_lactation_episode_animal FOREIGN KEY (animal_id) REFERENCES animal(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS gestation_episode (
  id VARCHAR(64) NOT NULL,
  animal_id VARCHAR(64) NOT NULL,
  reproduction_cycle_id VARCHAR(64) NULL,
  parity_no INT NULL,
  conception_at DATETIME(3) NULL,
  expected_calving_date DATE NULL,
  ended_at DATETIME(3) NULL,
  result VARCHAR(64) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'open',
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_gestation_animal (animal_id, conception_at),
  KEY idx_gestation_cycle (reproduction_cycle_id),
  CONSTRAINT fk_gestation_animal FOREIGN KEY (animal_id) REFERENCES animal(id),
  CONSTRAINT fk_gestation_cycle FOREIGN KEY (reproduction_cycle_id) REFERENCES reproduction_cycle(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS dry_period_episode (
  id VARCHAR(64) NOT NULL,
  animal_id VARCHAR(64) NOT NULL,
  lactation_id VARCHAR(64) NULL,
  parity_no INT NULL,
  start_date DATE NOT NULL,
  end_date DATE NULL,
  dry_reason VARCHAR(128) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'open',
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_dry_period_animal (animal_id, start_date),
  KEY idx_dry_period_lactation (lactation_id),
  CONSTRAINT fk_dry_period_animal FOREIGN KEY (animal_id) REFERENCES animal(id),
  CONSTRAINT fk_dry_period_lactation FOREIGN KEY (lactation_id) REFERENCES lactation_episode(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fact_event_count_day (
  id VARCHAR(64) NOT NULL,
  animal_id VARCHAR(64) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  day_date DATE NOT NULL,
  event_count INT NOT NULL DEFAULT 0,
  severity_summary JSON NULL,
  recomputed_at DATETIME(3) NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_event_count_day (animal_id, event_type, day_date),
  KEY idx_event_count_day_type (event_type, day_date),
  CONSTRAINT fk_event_count_day_animal FOREIGN KEY (animal_id) REFERENCES animal(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fact_event_count_month (
  id VARCHAR(64) NOT NULL,
  animal_id VARCHAR(64) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  month_key VARCHAR(16) NOT NULL,
  event_count INT NOT NULL DEFAULT 0,
  recomputed_at DATETIME(3) NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_event_count_month (animal_id, event_type, month_key),
  KEY idx_event_count_month_type (event_type, month_key),
  CONSTRAINT fk_event_count_month_animal FOREIGN KEY (animal_id) REFERENCES animal(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fact_event_count_year (
  id VARCHAR(64) NOT NULL,
  animal_id VARCHAR(64) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  year_num INT NOT NULL,
  event_count INT NOT NULL DEFAULT 0,
  recomputed_at DATETIME(3) NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_event_count_year (animal_id, event_type, year_num),
  KEY idx_event_count_year_type (event_type, year_num),
  CONSTRAINT fk_event_count_year_animal FOREIGN KEY (animal_id) REFERENCES animal(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fact_event_count_cycle (
  id VARCHAR(64) NOT NULL,
  animal_id VARCHAR(64) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  reproduction_cycle_id VARCHAR(64) NOT NULL,
  event_count INT NOT NULL DEFAULT 0,
  recomputed_at DATETIME(3) NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_event_count_cycle (animal_id, event_type, reproduction_cycle_id),
  KEY idx_event_count_cycle_type (event_type),
  CONSTRAINT fk_event_count_cycle_animal FOREIGN KEY (animal_id) REFERENCES animal(id),
  CONSTRAINT fk_event_count_cycle_cycle FOREIGN KEY (reproduction_cycle_id) REFERENCES reproduction_cycle(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fact_event_count_parity (
  id VARCHAR(64) NOT NULL,
  animal_id VARCHAR(64) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  parity_no INT NOT NULL,
  event_count INT NOT NULL DEFAULT 0,
  recomputed_at DATETIME(3) NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_event_count_parity (animal_id, event_type, parity_no),
  KEY idx_event_count_parity_type (event_type, parity_no),
  CONSTRAINT fk_event_count_parity_animal FOREIGN KEY (animal_id) REFERENCES animal(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fact_event_count_lactation (
  id VARCHAR(64) NOT NULL,
  animal_id VARCHAR(64) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  lactation_id VARCHAR(64) NOT NULL,
  event_count INT NOT NULL DEFAULT 0,
  recomputed_at DATETIME(3) NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_event_count_lactation (animal_id, event_type, lactation_id),
  KEY idx_event_count_lactation_type (event_type),
  CONSTRAINT fk_event_count_lactation_animal FOREIGN KEY (animal_id) REFERENCES animal(id),
  CONSTRAINT fk_event_count_lactation_lactation FOREIGN KEY (lactation_id) REFERENCES lactation_episode(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS dictionary_category (
  id VARCHAR(64) NOT NULL,
  code VARCHAR(64) NOT NULL,
  name VARCHAR(128) NOT NULL,
  domain VARCHAR(64) NOT NULL,
  parent_id VARCHAR(64) NULL,
  editable_level VARCHAR(32) NOT NULL DEFAULT 'tenant',
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_dictionary_category_code (code),
  KEY idx_dictionary_category_domain (domain),
  KEY idx_dictionary_category_parent (parent_id),
  CONSTRAINT fk_dictionary_category_parent FOREIGN KEY (parent_id) REFERENCES dictionary_category(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS dictionary_item (
  id VARCHAR(64) NOT NULL,
  category_id VARCHAR(64) NOT NULL,
  code VARCHAR(64) NOT NULL,
  name VARCHAR(128) NOT NULL,
  parent_id VARCHAR(64) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  extra_config JSON NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_dictionary_item_code (category_id, code),
  KEY idx_dictionary_item_parent (parent_id),
  CONSTRAINT fk_dictionary_item_category FOREIGN KEY (category_id) REFERENCES dictionary_category(id),
  CONSTRAINT fk_dictionary_item_parent FOREIGN KEY (parent_id) REFERENCES dictionary_item(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS custom_field_definition (
  id VARCHAR(64) NOT NULL,
  domain VARCHAR(64) NOT NULL,
  entity_type VARCHAR(64) NOT NULL,
  field_code VARCHAR(64) NOT NULL,
  field_name VARCHAR(128) NOT NULL,
  category_id VARCHAR(64) NULL,
  data_type VARCHAR(32) NOT NULL,
  unit VARCHAR(32) NULL,
  value_rule JSON NULL,
  dictionary_category_id VARCHAR(64) NULL,
  is_required TINYINT(1) NOT NULL DEFAULT 0,
  is_filterable TINYINT(1) NOT NULL DEFAULT 1,
  is_exportable TINYINT(1) NOT NULL DEFAULT 1,
  is_promoted TINYINT(1) NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_custom_field_code (domain, entity_type, field_code),
  KEY idx_custom_field_domain (domain, entity_type),
  KEY idx_custom_field_category (category_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS custom_field_value (
  id VARCHAR(64) NOT NULL,
  field_id VARCHAR(64) NOT NULL,
  entity_type VARCHAR(64) NOT NULL,
  entity_id VARCHAR(64) NOT NULL,
  animal_id VARCHAR(64) NULL,
  value_number DECIMAL(18,6) NULL,
  value_text TEXT NULL,
  value_date DATE NULL,
  value_datetime DATETIME(3) NULL,
  value_json JSON NULL,
  source_record_id VARCHAR(64) NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_custom_field_value (field_id, entity_type, entity_id),
  KEY idx_custom_value_entity (entity_type, entity_id),
  KEY idx_custom_value_animal (animal_id),
  CONSTRAINT fk_custom_value_field FOREIGN KEY (field_id) REFERENCES custom_field_definition(id),
  CONSTRAINT fk_custom_value_animal FOREIGN KEY (animal_id) REFERENCES animal(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS field_promotion_request (
  id VARCHAR(64) NOT NULL,
  field_id VARCHAR(64) NOT NULL,
  target_table VARCHAR(128) NULL,
  target_column VARCHAR(128) NULL,
  request_reason TEXT NULL,
  request_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  requested_by VARCHAR(128) NULL,
  reviewed_by VARCHAR(128) NULL,
  requested_at DATETIME(3) NULL,
  reviewed_at DATETIME(3) NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_field_promotion_field (field_id),
  KEY idx_field_promotion_status (request_status),
  CONSTRAINT fk_field_promotion_field FOREIGN KEY (field_id) REFERENCES custom_field_definition(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS duplicate_detection_rule (
  id VARCHAR(64) NOT NULL,
  domain VARCHAR(64) NOT NULL,
  table_name VARCHAR(128) NOT NULL,
  rule_code VARCHAR(64) NOT NULL,
  rule_name VARCHAR(128) NOT NULL,
  key_fields JSON NOT NULL,
  time_tolerance_seconds INT NULL,
  action_on_duplicate VARCHAR(64) NOT NULL DEFAULT 'merge',
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_duplicate_rule_code (domain, table_name, rule_code),
  KEY idx_duplicate_rule_table (table_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS medicine (
  id VARCHAR(64) NOT NULL,
  code VARCHAR(64) NOT NULL,
  name VARCHAR(128) NOT NULL,
  category VARCHAR(64) NULL,
  active_ingredient VARCHAR(256) NULL,
  specification VARCHAR(128) NULL,
  unit VARCHAR(32) NULL,
  manufacturer VARCHAR(128) NULL,
  default_withdrawal_milk_days INT NULL,
  default_withdrawal_meat_days INT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_medicine_code (code),
  KEY idx_medicine_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS medicine_batch (
  id VARCHAR(64) NOT NULL,
  medicine_id VARCHAR(64) NOT NULL,
  batch_no VARCHAR(128) NOT NULL,
  production_date DATE NULL,
  expiry_date DATE NULL,
  supplier VARCHAR(128) NULL,
  purchase_quantity DECIMAL(18,6) NULL,
  remaining_quantity DECIMAL(18,6) NULL,
  unit VARCHAR(32) NULL,
  storage_unit_id VARCHAR(64) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'available',
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_medicine_batch_no (medicine_id, batch_no),
  KEY idx_medicine_batch_expiry (expiry_date),
  CONSTRAINT fk_medicine_batch_medicine FOREIGN KEY (medicine_id) REFERENCES medicine(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS medication_order (
  id VARCHAR(64) NOT NULL,
  animal_id VARCHAR(64) NOT NULL,
  event_id VARCHAR(64) NULL,
  order_code VARCHAR(64) NOT NULL,
  diagnosis VARCHAR(256) NULL,
  medicine_id VARCHAR(64) NULL,
  planned_dose DECIMAL(18,6) NULL,
  dose_unit VARCHAR(32) NULL,
  route VARCHAR(64) NULL,
  frequency_rule JSON NULL,
  start_at DATETIME(3) NULL,
  end_at DATETIME(3) NULL,
  veterinarian VARCHAR(128) NULL,
  order_status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_medication_order_code (order_code),
  KEY idx_medication_order_animal (animal_id, start_at),
  KEY idx_medication_order_status (order_status),
  CONSTRAINT fk_medication_order_animal FOREIGN KEY (animal_id) REFERENCES animal(id),
  CONSTRAINT fk_medication_order_medicine FOREIGN KEY (medicine_id) REFERENCES medicine(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS medication_administration (
  id VARCHAR(64) NOT NULL,
  order_id VARCHAR(64) NULL,
  animal_id VARCHAR(64) NOT NULL,
  medicine_id VARCHAR(64) NULL,
  medicine_batch_id VARCHAR(64) NULL,
  administered_at DATETIME(3) NOT NULL,
  dose DECIMAL(18,6) NULL,
  dose_unit VARCHAR(32) NULL,
  route VARCHAR(64) NULL,
  administrator VARCHAR(128) NULL,
  administration_status VARCHAR(32) NOT NULL DEFAULT 'completed',
  notes TEXT NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_med_admin_animal_time (animal_id, administered_at),
  KEY idx_med_admin_order (order_id),
  KEY idx_med_admin_batch (medicine_batch_id),
  CONSTRAINT fk_med_admin_order FOREIGN KEY (order_id) REFERENCES medication_order(id),
  CONSTRAINT fk_med_admin_animal FOREIGN KEY (animal_id) REFERENCES animal(id),
  CONSTRAINT fk_med_admin_medicine FOREIGN KEY (medicine_id) REFERENCES medicine(id),
  CONSTRAINT fk_med_admin_batch FOREIGN KEY (medicine_batch_id) REFERENCES medicine_batch(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS withdrawal_tracking (
  id VARCHAR(64) NOT NULL,
  animal_id VARCHAR(64) NOT NULL,
  administration_id VARCHAR(64) NULL,
  withdrawal_type VARCHAR(32) NOT NULL,
  start_at DATETIME(3) NOT NULL,
  end_at DATETIME(3) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  release_by VARCHAR(128) NULL,
  release_at DATETIME(3) NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_withdrawal_animal (animal_id, status, end_at),
  KEY idx_withdrawal_admin (administration_id),
  CONSTRAINT fk_withdrawal_animal FOREIGN KEY (animal_id) REFERENCES animal(id),
  CONSTRAINT fk_withdrawal_admin FOREIGN KEY (administration_id) REFERENCES medication_administration(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS residue_test (
  id VARCHAR(64) NOT NULL,
  animal_id VARCHAR(64) NULL,
  sample_code VARCHAR(64) NOT NULL,
  sample_type VARCHAR(64) NOT NULL,
  collected_at DATETIME(3) NOT NULL,
  test_item VARCHAR(128) NOT NULL,
  result_value DECIMAL(18,6) NULL,
  result_text VARCHAR(256) NULL,
  unit VARCHAR(32) NULL,
  result_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  lab_name VARCHAR(128) NULL,
  report_no VARCHAR(128) NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_residue_sample_item (sample_code, test_item),
  KEY idx_residue_animal (animal_id, collected_at),
  CONSTRAINT fk_residue_animal FOREIGN KEY (animal_id) REFERENCES animal(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inventory_ledger (
  id VARCHAR(64) NOT NULL,
  item_type VARCHAR(64) NOT NULL,
  item_id VARCHAR(64) NOT NULL,
  batch_id VARCHAR(64) NULL,
  unit_id VARCHAR(64) NULL,
  movement_type VARCHAR(64) NOT NULL,
  quantity DECIMAL(18,6) NOT NULL,
  unit VARCHAR(32) NULL,
  occurred_at DATETIME(3) NOT NULL,
  source_doc_type VARCHAR(64) NULL,
  source_doc_id VARCHAR(64) NULL,
  operator_name VARCHAR(128) NULL,
  notes TEXT NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_inventory_item (item_type, item_id, occurred_at),
  KEY idx_inventory_unit (unit_id, occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS device (
  id VARCHAR(64) NOT NULL,
  code VARCHAR(64) NOT NULL,
  name VARCHAR(128) NOT NULL,
  device_type VARCHAR(64) NOT NULL,
  manufacturer VARCHAR(128) NULL,
  model VARCHAR(128) NULL,
  serial_no VARCHAR(128) NULL,
  unit_id VARCHAR(64) NULL,
  install_at DATETIME(3) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  configuration JSON NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_device_code (code),
  KEY idx_device_type (device_type),
  KEY idx_device_unit (unit_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS device_channel (
  id VARCHAR(64) NOT NULL,
  device_id VARCHAR(64) NOT NULL,
  channel_code VARCHAR(64) NOT NULL,
  channel_name VARCHAR(128) NULL,
  metric_code VARCHAR(64) NULL,
  unit VARCHAR(32) NULL,
  calibration_config JSON NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_device_channel (device_id, channel_code),
  KEY idx_device_channel_metric (metric_code),
  CONSTRAINT fk_device_channel_device FOREIGN KEY (device_id) REFERENCES device(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS animal_device_assignment (
  id VARCHAR(64) NOT NULL,
  animal_id VARCHAR(64) NOT NULL,
  device_id VARCHAR(64) NOT NULL,
  channel_id VARCHAR(64) NULL,
  assigned_at DATETIME(3) NOT NULL,
  released_at DATETIME(3) NULL,
  assignment_reason VARCHAR(128) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_animal_device_animal (animal_id, assigned_at),
  KEY idx_animal_device_device (device_id, assigned_at),
  CONSTRAINT fk_animal_device_animal FOREIGN KEY (animal_id) REFERENCES animal(id),
  CONSTRAINT fk_animal_device_device FOREIGN KEY (device_id) REFERENCES device(id),
  CONSTRAINT fk_animal_device_channel FOREIGN KEY (channel_id) REFERENCES device_channel(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS milking_session (
  id VARCHAR(64) NOT NULL,
  session_code VARCHAR(64) NOT NULL,
  unit_id VARCHAR(64) NULL,
  shift_id VARCHAR(64) NULL,
  production_date DATE NOT NULL,
  started_at DATETIME(3) NOT NULL,
  ended_at DATETIME(3) NULL,
  operator_name VARCHAR(128) NULL,
  session_status VARCHAR(32) NOT NULL DEFAULT 'open',
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_milking_session_code (session_code),
  KEY idx_milking_session_date (production_date, shift_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS milking_visit (
  id VARCHAR(64) NOT NULL,
  session_id VARCHAR(64) NOT NULL,
  animal_id VARCHAR(64) NOT NULL,
  stall_no VARCHAR(64) NULL,
  entered_at DATETIME(3) NULL,
  started_at DATETIME(3) NULL,
  ended_at DATETIME(3) NULL,
  visit_status VARCHAR(32) NOT NULL DEFAULT 'completed',
  reject_reason VARCHAR(128) NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_milking_visit_session (session_id),
  KEY idx_milking_visit_animal (animal_id, started_at),
  CONSTRAINT fk_milking_visit_session FOREIGN KEY (session_id) REFERENCES milking_session(id),
  CONSTRAINT fk_milking_visit_animal FOREIGN KEY (animal_id) REFERENCES animal(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS milk_measurement (
  id VARCHAR(64) NOT NULL,
  visit_id VARCHAR(64) NULL,
  animal_id VARCHAR(64) NOT NULL,
  measured_at DATETIME(3) NOT NULL,
  production_date DATE NULL,
  parity_no INT NULL,
  lactation_id VARCHAR(64) NULL,
  milk_yield DECIMAL(18,6) NULL,
  milk_flow_avg DECIMAL(18,6) NULL,
  milk_flow_peak DECIMAL(18,6) NULL,
  conductivity DECIMAL(18,6) NULL,
  milk_temperature DECIMAL(18,6) NULL,
  fat_percent DECIMAL(18,6) NULL,
  protein_percent DECIMAL(18,6) NULL,
  lactose_percent DECIMAL(18,6) NULL,
  somatic_cell_count DECIMAL(18,6) NULL,
  reported_age_months DECIMAL(10,2) NULL,
  reported_lactation_month INT NULL,
  source_type VARCHAR(64) NULL,
  quality_flag VARCHAR(32) NOT NULL DEFAULT 'valid',
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_milk_measurement_animal_time (animal_id, measured_at),
  KEY idx_milk_measurement_date (production_date),
  KEY idx_milk_measurement_visit (visit_id),
  CONSTRAINT fk_milk_measurement_visit FOREIGN KEY (visit_id) REFERENCES milking_visit(id),
  CONSTRAINT fk_milk_measurement_animal FOREIGN KEY (animal_id) REFERENCES animal(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sensor_reading (
  id VARCHAR(64) NOT NULL,
  animal_id VARCHAR(64) NULL,
  device_id VARCHAR(64) NULL,
  channel_id VARCHAR(64) NULL,
  metric_code VARCHAR(64) NOT NULL,
  reading_value DECIMAL(18,6) NULL,
  reading_text VARCHAR(256) NULL,
  unit VARCHAR(32) NULL,
  measured_at DATETIME(3) NOT NULL,
  production_date DATE NULL,
  quality_flag VARCHAR(32) NOT NULL DEFAULT 'valid',
  raw_payload JSON NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_sensor_reading_animal_metric (animal_id, metric_code, measured_at),
  KEY idx_sensor_reading_device (device_id, measured_at),
  KEY idx_sensor_reading_metric_time (metric_code, measured_at),
  CONSTRAINT fk_sensor_reading_animal FOREIGN KEY (animal_id) REFERENCES animal(id),
  CONSTRAINT fk_sensor_reading_device FOREIGN KEY (device_id) REFERENCES device(id),
  CONSTRAINT fk_sensor_reading_channel FOREIGN KEY (channel_id) REFERENCES device_channel(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS data_quality_issue (
  id VARCHAR(64) NOT NULL,
  domain VARCHAR(64) NOT NULL,
  table_name VARCHAR(128) NOT NULL,
  record_id VARCHAR(64) NULL,
  animal_id VARCHAR(64) NULL,
  issue_type VARCHAR(64) NOT NULL,
  severity VARCHAR(32) NOT NULL DEFAULT 'medium',
  detected_at DATETIME(3) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'open',
  resolution_note TEXT NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_data_quality_record (table_name, record_id),
  KEY idx_data_quality_animal (animal_id, detected_at),
  KEY idx_data_quality_status (status, severity),
  CONSTRAINT fk_data_quality_animal FOREIGN KEY (animal_id) REFERENCES animal(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS research_project (
  id VARCHAR(64) NOT NULL,
  project_code VARCHAR(64) NOT NULL,
  project_name VARCHAR(256) NOT NULL,
  principal_investigator VARCHAR(128) NULL,
  project_type VARCHAR(64) NULL,
  start_date DATE NULL,
  end_date DATE NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  description TEXT NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_research_project_code (project_code),
  KEY idx_research_project_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS research_cohort_definition (
  id VARCHAR(64) NOT NULL,
  project_id VARCHAR(64) NOT NULL,
  cohort_code VARCHAR(64) NOT NULL,
  cohort_name VARCHAR(128) NOT NULL,
  selection_filter JSON NOT NULL,
  animal_count INT NOT NULL DEFAULT 0,
  frozen_at DATETIME(3) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_research_cohort_code (project_id, cohort_code),
  KEY idx_research_cohort_project (project_id),
  CONSTRAINT fk_research_cohort_project FOREIGN KEY (project_id) REFERENCES research_project(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS research_variable_set (
  id VARCHAR(64) NOT NULL,
  project_id VARCHAR(64) NOT NULL,
  variable_set_code VARCHAR(64) NOT NULL,
  variable_set_name VARCHAR(128) NOT NULL,
  variables JSON NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_research_variable_set (project_id, variable_set_code),
  CONSTRAINT fk_research_variable_project FOREIGN KEY (project_id) REFERENCES research_project(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS research_extract_job (
  id VARCHAR(64) NOT NULL,
  project_id VARCHAR(64) NULL,
  cohort_id VARCHAR(64) NULL,
  variable_set_id VARCHAR(64) NULL,
  job_code VARCHAR(64) NOT NULL,
  job_name VARCHAR(128) NULL,
  requested_by VARCHAR(128) NULL,
  requested_at DATETIME(3) NULL,
  job_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  period_filter JSON NULL,
  output_format VARCHAR(32) NOT NULL DEFAULT 'xlsx',
  row_count INT NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_research_extract_job_code (job_code),
  KEY idx_research_extract_project (project_id, requested_at),
  KEY idx_research_extract_status (job_status),
  CONSTRAINT fk_research_extract_project FOREIGN KEY (project_id) REFERENCES research_project(id),
  CONSTRAINT fk_research_extract_cohort FOREIGN KEY (cohort_id) REFERENCES research_cohort_definition(id),
  CONSTRAINT fk_research_extract_variable FOREIGN KEY (variable_set_id) REFERENCES research_variable_set(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS research_extract_filter (
  id VARCHAR(64) NOT NULL,
  job_id VARCHAR(64) NOT NULL,
  filter_domain VARCHAR(64) NOT NULL,
  filter_field VARCHAR(128) NOT NULL,
  comparator VARCHAR(32) NOT NULL,
  filter_value JSON NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_research_filter_job (job_id),
  CONSTRAINT fk_research_filter_job FOREIGN KEY (job_id) REFERENCES research_extract_job(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS research_extract_variable (
  id VARCHAR(64) NOT NULL,
  job_id VARCHAR(64) NOT NULL,
  variable_domain VARCHAR(64) NOT NULL,
  variable_code VARCHAR(128) NOT NULL,
  period_type VARCHAR(64) NULL,
  aggregation_method VARCHAR(64) NULL,
  output_name VARCHAR(128) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_research_variable_job (job_id),
  KEY idx_research_variable_code (variable_domain, variable_code),
  CONSTRAINT fk_research_extract_variable_job FOREIGN KEY (job_id) REFERENCES research_extract_job(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS research_dataset_snapshot (
  id VARCHAR(64) NOT NULL,
  job_id VARCHAR(64) NOT NULL,
  snapshot_code VARCHAR(64) NOT NULL,
  snapshot_name VARCHAR(128) NULL,
  snapshot_version VARCHAR(64) NULL,
  row_count INT NOT NULL DEFAULT 0,
  column_count INT NOT NULL DEFAULT 0,
  source_tables JSON NULL,
  lineage_hash VARCHAR(128) NULL,
  created_by VARCHAR(128) NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_research_snapshot_code (snapshot_code),
  KEY idx_research_snapshot_job (job_id),
  CONSTRAINT fk_research_snapshot_job FOREIGN KEY (job_id) REFERENCES research_extract_job(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS research_dataset_artifact (
  id VARCHAR(64) NOT NULL,
  snapshot_id VARCHAR(64) NOT NULL,
  artifact_type VARCHAR(64) NOT NULL,
  file_name VARCHAR(256) NOT NULL,
  file_path VARCHAR(512) NULL,
  file_size BIGINT NULL,
  checksum VARCHAR(128) NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_research_artifact_snapshot (snapshot_id),
  CONSTRAINT fk_research_artifact_snapshot FOREIGN KEY (snapshot_id) REFERENCES research_dataset_snapshot(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS data_dictionary_snapshot (
  id VARCHAR(64) NOT NULL,
  snapshot_id VARCHAR(64) NULL,
  dictionary_domain VARCHAR(64) NOT NULL,
  dictionary_payload JSON NOT NULL,
  version_label VARCHAR(64) NULL,
  created_by VARCHAR(128) NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_dictionary_snapshot_snapshot (snapshot_id),
  KEY idx_dictionary_snapshot_domain (dictionary_domain),
  CONSTRAINT fk_dictionary_snapshot_research FOREIGN KEY (snapshot_id) REFERENCES research_dataset_snapshot(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS omics_samples (
  id VARCHAR(64) NOT NULL,
  sample_code VARCHAR(64) NOT NULL,
  animal_id VARCHAR(64) NULL,
  cow_id VARCHAR(64) NULL,
  cow_number VARCHAR(64) NULL,
  sample_type VARCHAR(64) NOT NULL,
  collection_date DATETIME(3) NULL,
  received_date DATETIME(3) NULL,
  storage_location VARCHAR(128) NULL,
  source_tissue VARCHAR(64) NULL,
  collector VARCHAR(128) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  quality_score DECIMAL(8,4) NULL,
  integrity_score DECIMAL(8,4) NULL,
  phenotype_links JSON NULL,
  metadata_json JSON NULL,
  notes TEXT NULL,
  cow_ids JSON NULL,
  relation_scope JSON NULL,
  source_record_ids JSON NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_omics_samples_sample_code (sample_code),
  KEY idx_omics_samples_animal (animal_id),
  KEY idx_omics_samples_cow_id (cow_id),
  KEY idx_omics_samples_cow_number (cow_number),
  KEY idx_omics_samples_type (sample_type),
  KEY idx_omics_samples_status (status),
  KEY idx_omics_samples_collection (collection_date),
  CONSTRAINT fk_omics_samples_animal FOREIGN KEY (animal_id) REFERENCES animal(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS omics_datasets (
  id VARCHAR(64) NOT NULL,
  dataset_code VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  data_type VARCHAR(64) NOT NULL,
  platform VARCHAR(64) NOT NULL,
  reference_genome VARCHAR(64) NULL,
  source_lab VARCHAR(128) NULL,
  sample_ids JSON NULL,
  sample_count INT NOT NULL DEFAULT 0,
  record_count INT NULL,
  release_version VARCHAR(64) NULL,
  matrix_file_path VARCHAR(512) NULL,
  matrix_json JSON NULL,
  quality_metrics JSON NULL,
  tags JSON NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  generated_at DATETIME(3) NULL,
  published_at DATETIME(3) NULL,
  cow_ids JSON NULL,
  relation_scope JSON NULL,
  source_record_ids JSON NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_omics_datasets_dataset_code (dataset_code),
  KEY idx_omics_datasets_name (name),
  KEY idx_omics_datasets_type (data_type),
  KEY idx_omics_datasets_platform (platform),
  KEY idx_omics_datasets_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS omics_markers (
  id VARCHAR(64) NOT NULL,
  dataset_id VARCHAR(64) NOT NULL,
  marker_code VARCHAR(64) NOT NULL,
  marker_type VARCHAR(64) NOT NULL,
  chromosome VARCHAR(32) NULL,
  position_bp BIGINT NULL,
  gene_symbol VARCHAR(128) NULL,
  reference_allele VARCHAR(32) NULL,
  alternate_allele VARCHAR(32) NULL,
  effect_type VARCHAR(64) NULL,
  trait VARCHAR(128) NULL,
  maf DECIMAL(10,6) NULL,
  p_value DECIMAL(18,10) NULL,
  effect_size DECIMAL(18,8) NULL,
  evidence_level VARCHAR(64) NULL,
  payload JSON NULL,
  cow_ids JSON NULL,
  relation_scope JSON NULL,
  source_record_ids JSON NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_omics_markers_dataset_marker (dataset_id, marker_code),
  KEY idx_omics_markers_dataset (dataset_id),
  KEY idx_omics_markers_type (marker_type),
  KEY idx_omics_markers_trait (trait),
  KEY idx_omics_markers_gene (gene_symbol)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS multi_omics_associations (
  id VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  trait VARCHAR(128) NOT NULL,
  primary_dataset_id VARCHAR(64) NOT NULL,
  secondary_dataset_id VARCHAR(64) NULL,
  association_type VARCHAR(64) NOT NULL,
  method VARCHAR(64) NULL,
  sample_size INT NULL,
  significance DECIMAL(18,10) NULL,
  effect_size DECIMAL(18,8) NULL,
  candidate_genes JSON NULL,
  candidate_markers JSON NULL,
  visualization_type VARCHAR(64) NULL,
  conclusion TEXT NULL,
  payload JSON NULL,
  cow_ids JSON NULL,
  relation_scope JSON NULL,
  source_record_ids JSON NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_multi_omics_trait (trait),
  KEY idx_multi_omics_primary_dataset (primary_dataset_id),
  KEY idx_multi_omics_secondary_dataset (secondary_dataset_id),
  KEY idx_multi_omics_type (association_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS breeding_analyses (
  id VARCHAR(64) NOT NULL,
  analysis_code VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  target_trait VARCHAR(128) NOT NULL,
  dataset_ids JSON NULL,
  model_type VARCHAR(64) NOT NULL,
  population_size INT NOT NULL DEFAULT 0,
  heritability DECIMAL(10,6) NULL,
  reliability DECIMAL(10,6) NULL,
  predicted_gain DECIMAL(18,8) NULL,
  selection_index JSON NULL,
  top_candidates JSON NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  summary TEXT NULL,
  cow_ids JSON NULL,
  relation_scope JSON NULL,
  source_record_ids JSON NULL,
  executed_at DATETIME(3) NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_breeding_analyses_code (analysis_code),
  KEY idx_breeding_analyses_trait (target_trait),
  KEY idx_breeding_analyses_model (model_type),
  KEY idx_breeding_analyses_status (status),
  KEY idx_breeding_analyses_executed (executed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS omics_dataset_sample (
  id VARCHAR(64) NOT NULL,
  dataset_id VARCHAR(64) NOT NULL,
  sample_id VARCHAR(64) NOT NULL,
  animal_id VARCHAR(64) NULL,
  group_label VARCHAR(128) NULL,
  phenotype_snapshot JSON NULL,
  included_flag TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_omics_dataset_sample (dataset_id, sample_id),
  KEY idx_omics_dataset_sample_animal (animal_id),
  CONSTRAINT fk_omics_dataset_sample_animal FOREIGN KEY (animal_id) REFERENCES animal(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS omics_feature (
  id VARCHAR(64) NOT NULL,
  dataset_id VARCHAR(64) NOT NULL,
  feature_code VARCHAR(128) NOT NULL,
  feature_name VARCHAR(256) NULL,
  feature_type VARCHAR(64) NOT NULL,
  chromosome VARCHAR(64) NULL,
  position_bp BIGINT NULL,
  gene_symbol VARCHAR(128) NULL,
  annotation JSON NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_omics_feature_code (dataset_id, feature_code),
  KEY idx_omics_feature_type (feature_type),
  KEY idx_omics_feature_gene (gene_symbol)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS omics_trait_link (
  id VARCHAR(64) NOT NULL,
  feature_id VARCHAR(64) NULL,
  trait_id VARCHAR(64) NULL,
  dataset_id VARCHAR(64) NULL,
  link_type VARCHAR(64) NOT NULL,
  effect_size DECIMAL(18,8) NULL,
  p_value DECIMAL(18,12) NULL,
  fdr DECIMAL(18,12) NULL,
  evidence_level VARCHAR(64) NULL,
  source_run_id VARCHAR(64) NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_omics_trait_feature (feature_id),
  KEY idx_omics_trait_trait (trait_id),
  KEY idx_omics_trait_dataset (dataset_id),
  CONSTRAINT fk_omics_trait_feature FOREIGN KEY (feature_id) REFERENCES omics_feature(id),
  CONSTRAINT fk_omics_trait_trait FOREIGN KEY (trait_id) REFERENCES trait_definition(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS omics_artifact (
  id VARCHAR(64) NOT NULL,
  run_type VARCHAR(64) NOT NULL,
  run_id VARCHAR(64) NOT NULL,
  artifact_type VARCHAR(64) NOT NULL,
  artifact_name VARCHAR(256) NULL,
  artifact_payload JSON NULL,
  file_path VARCHAR(512) NULL,
  checksum VARCHAR(128) NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_omics_artifact_run (run_type, run_id),
  KEY idx_omics_artifact_type (artifact_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS omics_module_runs (
  id VARCHAR(64) NOT NULL,
  module_id VARCHAR(64) NOT NULL,
  module_name VARCHAR(255) NOT NULL,
  trait VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL,
  data_source VARCHAR(32) NOT NULL,
  parameters JSON NULL,
  metrics JSON NULL,
  tables_json JSON NULL,
  charts_json JSON NULL,
  method_notes JSON NULL,
  input_summary JSON NULL,
  artifacts JSON NULL,
  cow_ids JSON NULL,
  relation_scope JSON NULL,
  source_record_ids JSON NULL,
  operator VARCHAR(128) NULL,
  run_code VARCHAR(128) NULL,
  started_at DATETIME(3) NULL,
  finished_at DATETIME(3) NULL,
  duration_ms INT NULL,
  summary TEXT NULL,
  error_message TEXT NULL,
  executed_at DATETIME(3) NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_omics_module_runs_module (module_id),
  KEY idx_omics_module_runs_trait (trait),
  KEY idx_omics_module_runs_status (status),
  KEY idx_omics_module_runs_executed (executed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS omics_workflow_runs (
  id VARCHAR(64) NOT NULL,
  workflow_id VARCHAR(64) NOT NULL,
  workflow_name VARCHAR(255) NOT NULL,
  trait VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL,
  data_source VARCHAR(32) NOT NULL,
  repository_ids JSON NULL,
  module_ids JSON NULL,
  module_run_ids JSON NULL,
  parameters JSON NULL,
  metrics JSON NULL,
  tables_json JSON NULL,
  charts_json JSON NULL,
  method_notes JSON NULL,
  input_summary JSON NULL,
  artifacts JSON NULL,
  cow_ids JSON NULL,
  relation_scope JSON NULL,
  source_record_ids JSON NULL,
  operator VARCHAR(128) NULL,
  run_code VARCHAR(128) NULL,
  started_at DATETIME(3) NULL,
  finished_at DATETIME(3) NULL,
  duration_ms INT NULL,
  summary TEXT NULL,
  conclusion TEXT NULL,
  error_message TEXT NULL,
  executed_at DATETIME(3) NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_omics_workflow_runs_workflow (workflow_id),
  KEY idx_omics_workflow_runs_trait (trait),
  KEY idx_omics_workflow_runs_status (status),
  KEY idx_omics_workflow_runs_executed (executed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS omics_analysis_artifacts (
  id VARCHAR(64) NOT NULL,
  run_id VARCHAR(64) NOT NULL,
  run_type VARCHAR(32) NOT NULL,
  artifact_type VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  cow_ids JSON NULL,
  relation_scope JSON NULL,
  source_record_ids JSON NULL,
  payload JSON NULL,
  created_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_omics_analysis_artifacts_run (run_id, run_type),
  KEY idx_omics_analysis_artifacts_type (artifact_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS breeding_value_run (
  id VARCHAR(64) NOT NULL,
  run_code VARCHAR(64) NOT NULL,
  run_name VARCHAR(128) NULL,
  trait_id VARCHAR(64) NULL,
  model_type VARCHAR(64) NOT NULL,
  input_snapshot_id VARCHAR(64) NULL,
  parameters JSON NULL,
  operator_name VARCHAR(128) NULL,
  run_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  started_at DATETIME(3) NULL,
  finished_at DATETIME(3) NULL,
  metrics JSON NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_breeding_value_run_code (run_code),
  KEY idx_breeding_value_run_trait (trait_id),
  KEY idx_breeding_value_run_status (run_status),
  CONSTRAINT fk_breeding_value_run_trait FOREIGN KEY (trait_id) REFERENCES trait_definition(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS breeding_value (
  id VARCHAR(64) NOT NULL,
  run_id VARCHAR(64) NOT NULL,
  animal_id VARCHAR(64) NOT NULL,
  trait_id VARCHAR(64) NOT NULL,
  breeding_value DECIMAL(18,8) NOT NULL,
  reliability DECIMAL(8,4) NULL,
  rank_order INT NULL,
  percentile DECIMAL(8,4) NULL,
  parent_average DECIMAL(18,8) NULL,
  genomic_component DECIMAL(18,8) NULL,
  phenotype_component DECIMAL(18,8) NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_breeding_value (run_id, animal_id, trait_id),
  KEY idx_breeding_value_rank (run_id, trait_id, rank_order),
  KEY idx_breeding_value_animal (animal_id),
  CONSTRAINT fk_breeding_value_run FOREIGN KEY (run_id) REFERENCES breeding_value_run(id),
  CONSTRAINT fk_breeding_value_animal FOREIGN KEY (animal_id) REFERENCES animal(id),
  CONSTRAINT fk_breeding_value_trait FOREIGN KEY (trait_id) REFERENCES trait_definition(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS selection_index (
  id VARCHAR(64) NOT NULL,
  code VARCHAR(64) NOT NULL,
  name VARCHAR(128) NOT NULL,
  index_type VARCHAR(64) NOT NULL,
  trait_weights JSON NOT NULL,
  direction_rule JSON NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_by VARCHAR(128) NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_selection_index_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mating_recommendation (
  id VARCHAR(64) NOT NULL,
  female_animal_id VARCHAR(64) NOT NULL,
  male_animal_id VARCHAR(64) NOT NULL,
  recommendation_run_id VARCHAR(64) NULL,
  selection_index_id VARCHAR(64) NULL,
  score DECIMAL(18,8) NULL,
  inbreeding_coefficient DECIMAL(8,6) NULL,
  expected_trait_gain JSON NULL,
  risk_flags JSON NULL,
  rank_order INT NULL,
  recommendation_status VARCHAR(32) NOT NULL DEFAULT 'candidate',
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_mating_female_rank (female_animal_id, rank_order),
  KEY idx_mating_male (male_animal_id),
  CONSTRAINT fk_mating_female FOREIGN KEY (female_animal_id) REFERENCES animal(id),
  CONSTRAINT fk_mating_male FOREIGN KEY (male_animal_id) REFERENCES animal(id),
  CONSTRAINT fk_mating_index FOREIGN KEY (selection_index_id) REFERENCES selection_index(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alert_rule (
  id VARCHAR(64) NOT NULL,
  code VARCHAR(64) NOT NULL,
  name VARCHAR(128) NOT NULL,
  domain VARCHAR(64) NOT NULL,
  severity VARCHAR(32) NOT NULL DEFAULT 'medium',
  condition_config JSON NOT NULL,
  action_config JSON NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_alert_rule_code (code),
  KEY idx_alert_rule_domain (domain, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alert_case (
  id VARCHAR(64) NOT NULL,
  rule_id VARCHAR(64) NULL,
  animal_id VARCHAR(64) NULL,
  domain VARCHAR(64) NOT NULL,
  case_title VARCHAR(256) NOT NULL,
  severity VARCHAR(32) NOT NULL DEFAULT 'medium',
  triggered_at DATETIME(3) NOT NULL,
  case_status VARCHAR(32) NOT NULL DEFAULT 'open',
  evidence JSON NULL,
  assigned_to VARCHAR(128) NULL,
  resolved_at DATETIME(3) NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_alert_case_rule (rule_id),
  KEY idx_alert_case_animal (animal_id, triggered_at),
  KEY idx_alert_case_status (case_status, severity),
  CONSTRAINT fk_alert_case_rule FOREIGN KEY (rule_id) REFERENCES alert_rule(id),
  CONSTRAINT fk_alert_case_animal FOREIGN KEY (animal_id) REFERENCES animal(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS work_order (
  id VARCHAR(64) NOT NULL,
  alert_case_id VARCHAR(64) NULL,
  work_order_code VARCHAR(64) NOT NULL,
  title VARCHAR(256) NOT NULL,
  work_type VARCHAR(64) NOT NULL,
  animal_id VARCHAR(64) NULL,
  assigned_to VARCHAR(128) NULL,
  priority VARCHAR(32) NOT NULL DEFAULT 'normal',
  status VARCHAR(32) NOT NULL DEFAULT 'open',
  due_at DATETIME(3) NULL,
  completed_at DATETIME(3) NULL,
  result_note TEXT NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_work_order_code (work_order_code),
  KEY idx_work_order_alert (alert_case_id),
  KEY idx_work_order_animal (animal_id, status),
  KEY idx_work_order_status (status, priority),
  CONSTRAINT fk_work_order_alert FOREIGN KEY (alert_case_id) REFERENCES alert_case(id),
  CONSTRAINT fk_work_order_animal FOREIGN KEY (animal_id) REFERENCES animal(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS report_template (
  id VARCHAR(64) NOT NULL,
  code VARCHAR(64) NOT NULL,
  name VARCHAR(128) NOT NULL,
  report_domain VARCHAR(64) NOT NULL,
  layout_config JSON NULL,
  default_filters JSON NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_report_template_code (code),
  KEY idx_report_template_domain (report_domain)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS report_metric_definition (
  id VARCHAR(64) NOT NULL,
  template_id VARCHAR(64) NULL,
  metric_code VARCHAR(64) NOT NULL,
  metric_name VARCHAR(128) NOT NULL,
  metric_domain VARCHAR(64) NOT NULL,
  aggregation_method VARCHAR(64) NULL,
  source_table VARCHAR(128) NULL,
  source_field VARCHAR(128) NULL,
  filter_config JSON NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_report_metric_code (metric_code),
  KEY idx_report_metric_template (template_id),
  CONSTRAINT fk_report_metric_template FOREIGN KEY (template_id) REFERENCES report_template(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS report_run (
  id VARCHAR(64) NOT NULL,
  template_id VARCHAR(64) NULL,
  run_code VARCHAR(64) NOT NULL,
  run_name VARCHAR(128) NULL,
  period_type VARCHAR(64) NULL,
  period_start DATETIME(3) NULL,
  period_end DATETIME(3) NULL,
  filters JSON NULL,
  operator_name VARCHAR(128) NULL,
  run_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  started_at DATETIME(3) NULL,
  finished_at DATETIME(3) NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_report_run_code (run_code),
  KEY idx_report_run_template (template_id),
  KEY idx_report_run_period (period_type, period_start, period_end),
  CONSTRAINT fk_report_run_template FOREIGN KEY (template_id) REFERENCES report_template(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS report_run_item (
  id VARCHAR(64) NOT NULL,
  run_id VARCHAR(64) NOT NULL,
  metric_id VARCHAR(64) NULL,
  metric_code VARCHAR(64) NOT NULL,
  metric_value DECIMAL(18,6) NULL,
  metric_text VARCHAR(512) NULL,
  value_json JSON NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_report_item_run (run_id),
  KEY idx_report_item_metric (metric_code),
  CONSTRAINT fk_report_item_run FOREIGN KEY (run_id) REFERENCES report_run(id),
  CONSTRAINT fk_report_item_metric FOREIGN KEY (metric_id) REFERENCES report_metric_definition(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS export_scope_definition (
  id VARCHAR(64) NOT NULL,
  code VARCHAR(64) NOT NULL,
  name VARCHAR(128) NOT NULL,
  scope_domain VARCHAR(64) NOT NULL,
  selectable_filters JSON NOT NULL,
  selectable_variables JSON NOT NULL,
  default_periods JSON NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_export_scope_code (code),
  KEY idx_export_scope_domain (scope_domain)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS report_period_filter (
  id VARCHAR(64) NOT NULL,
  report_run_id VARCHAR(64) NULL,
  export_scope_id VARCHAR(64) NULL,
  period_type VARCHAR(64) NOT NULL,
  start_at DATETIME(3) NULL,
  end_at DATETIME(3) NULL,
  parity_no INT NULL,
  lactation_no INT NULL,
  cycle_no INT NULL,
  custom_window_code VARCHAR(64) NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_report_period_run (report_run_id),
  KEY idx_report_period_scope (export_scope_id),
  KEY idx_report_period_type (period_type),
  CONSTRAINT fk_report_period_run FOREIGN KEY (report_run_id) REFERENCES report_run(id),
  CONSTRAINT fk_report_period_scope FOREIGN KEY (export_scope_id) REFERENCES export_scope_definition(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS report_data_scope (
  id VARCHAR(64) NOT NULL,
  report_run_id VARCHAR(64) NULL,
  export_scope_id VARCHAR(64) NULL,
  scope_type VARCHAR(64) NOT NULL,
  scope_value VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_report_data_scope_run (report_run_id),
  KEY idx_report_data_scope_scope (export_scope_id),
  KEY idx_report_data_scope_value (scope_type, scope_value),
  CONSTRAINT fk_report_data_scope_run FOREIGN KEY (report_run_id) REFERENCES report_run(id),
  CONSTRAINT fk_report_data_scope_def FOREIGN KEY (export_scope_id) REFERENCES export_scope_definition(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS export_file (
  id VARCHAR(64) NOT NULL,
  export_code VARCHAR(64) NOT NULL,
  source_type VARCHAR(64) NOT NULL,
  source_id VARCHAR(64) NULL,
  file_name VARCHAR(256) NOT NULL,
  file_format VARCHAR(32) NOT NULL,
  file_path VARCHAR(512) NULL,
  file_size BIGINT NULL,
  row_count INT NULL,
  checksum VARCHAR(128) NULL,
  exported_by VARCHAR(128) NULL,
  exported_at DATETIME(3) NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_export_file_code (export_code),
  KEY idx_export_file_source (source_type, source_id),
  KEY idx_export_file_time (exported_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS permission_policy (
  id VARCHAR(64) NOT NULL,
  policy_code VARCHAR(64) NOT NULL,
  policy_name VARCHAR(128) NOT NULL,
  resource_domain VARCHAR(64) NOT NULL,
  action_code VARCHAR(64) NOT NULL,
  condition_config JSON NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_permission_policy_code (policy_code),
  KEY idx_permission_policy_resource (resource_domain, action_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS role_permission (
  id VARCHAR(64) NOT NULL,
  role_code VARCHAR(64) NOT NULL,
  policy_id VARCHAR(64) NOT NULL,
  granted_by VARCHAR(128) NULL,
  granted_at DATETIME(3) NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_role_permission (role_code, policy_id),
  CONSTRAINT fk_role_permission_policy FOREIGN KEY (policy_id) REFERENCES permission_policy(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS approval_workflow (
  id VARCHAR(64) NOT NULL,
  workflow_code VARCHAR(64) NOT NULL,
  workflow_name VARCHAR(128) NOT NULL,
  domain VARCHAR(64) NOT NULL,
  step_config JSON NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_approval_workflow_code (workflow_code),
  KEY idx_approval_workflow_domain (domain)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS operation_audit_log (
  id VARCHAR(64) NOT NULL,
  action_type VARCHAR(64) NOT NULL,
  target_type VARCHAR(64) NOT NULL,
  target_id VARCHAR(64) NULL,
  animal_id VARCHAR(64) NULL,
  operator_name VARCHAR(128) NULL,
  operated_at DATETIME(3) NOT NULL,
  request_payload JSON NULL,
  result_payload JSON NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'success',
  client_ip VARCHAR(64) NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_audit_target (target_type, target_id),
  KEY idx_audit_animal (animal_id, operated_at),
  KEY idx_audit_operator (operator_name, operated_at),
  CONSTRAINT fk_audit_animal FOREIGN KEY (animal_id) REFERENCES animal(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS correction_request (
  id VARCHAR(64) NOT NULL,
  domain VARCHAR(64) NOT NULL,
  table_name VARCHAR(128) NOT NULL,
  record_id VARCHAR(64) NOT NULL,
  animal_id VARCHAR(64) NULL,
  original_value JSON NULL,
  corrected_value JSON NULL,
  correction_reason TEXT NULL,
  request_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  requested_by VARCHAR(128) NULL,
  reviewed_by VARCHAR(128) NULL,
  requested_at DATETIME(3) NULL,
  reviewed_at DATETIME(3) NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_correction_record (table_name, record_id),
  KEY idx_correction_animal (animal_id),
  KEY idx_correction_status (request_status),
  CONSTRAINT fk_correction_animal FOREIGN KEY (animal_id) REFERENCES animal(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS derivation_recompute_job (
  id VARCHAR(64) NOT NULL,
  job_code VARCHAR(64) NOT NULL,
  derivation_domain VARCHAR(64) NOT NULL,
  target_table VARCHAR(128) NOT NULL,
  animal_id VARCHAR(64) NULL,
  period_type VARCHAR(64) NULL,
  period_start DATETIME(3) NULL,
  period_end DATETIME(3) NULL,
  trigger_source VARCHAR(64) NULL,
  trigger_record_id VARCHAR(64) NULL,
  job_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  started_at DATETIME(3) NULL,
  finished_at DATETIME(3) NULL,
  error_message TEXT NULL,
  created_at DATETIME(3) NULL,
  updated_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_recompute_job_code (job_code),
  KEY idx_recompute_target (target_table, job_status),
  KEY idx_recompute_animal (animal_id, period_type),
  CONSTRAINT fk_recompute_animal FOREIGN KEY (animal_id) REFERENCES animal(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
