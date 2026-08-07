-- Minimal paper-scoped schema for the LoRa ear-tag monitoring data path.
CREATE TABLE animal_profile (
    animal_id VARCHAR(36) PRIMARY KEY,
    public_animal_code VARCHAR(32) NOT NULL UNIQUE,
    breed VARCHAR(64),
    sex VARCHAR(16),
    pen_code VARCHAR(32),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE tag_registry (
    tag_id VARCHAR(36) PRIMARY KEY,
    device_code SMALLINT NOT NULL UNIQUE,
    hardware_revision VARCHAR(32),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE animal_tag_assignment (
    assignment_id VARCHAR(36) PRIMARY KEY,
    animal_id VARCHAR(36) NOT NULL,
    tag_id VARCHAR(36) NOT NULL,
    assigned_at DATETIME NOT NULL,
    released_at DATETIME,
    FOREIGN KEY (animal_id) REFERENCES animal_profile(animal_id),
    FOREIGN KEY (tag_id) REFERENCES tag_registry(tag_id)
);

CREATE TABLE thermal_reading (
    reading_id VARCHAR(36) PRIMARY KEY,
    tag_id VARCHAR(36) NOT NULL,
    animal_id VARCHAR(36),
    measured_at DATETIME NOT NULL,
    ear_surface_temperature_c DECIMAL(5,2) NOT NULL,
    local_ambient_temperature_c DECIMAL(5,2) NOT NULL,
    compensated_temperature_c DECIMAL(5,2),
    model_version VARCHAR(64),
    received_at DATETIME NOT NULL,
    FOREIGN KEY (tag_id) REFERENCES tag_registry(tag_id),
    FOREIGN KEY (animal_id) REFERENCES animal_profile(animal_id)
);

CREATE TABLE link_metric (
    metric_id VARCHAR(36) PRIMARY KEY,
    reading_id VARCHAR(36) NOT NULL,
    rssi_dbm DECIMAL(6,2),
    snr_db DECIMAL(6,2),
    frequency_error_hz DECIMAL(12,2),
    FOREIGN KEY (reading_id) REFERENCES thermal_reading(reading_id)
);

CREATE TABLE mqtt_message_log (
    message_id VARCHAR(64) PRIMARY KEY,
    topic VARCHAR(255) NOT NULL,
    raw_payload TEXT NOT NULL,
    received_at DATETIME NOT NULL,
    parse_status VARCHAR(32) NOT NULL
);

CREATE TABLE alert_case (
    alert_id VARCHAR(36) PRIMARY KEY,
    animal_id VARCHAR(36),
    reading_id VARCHAR(36),
    severity VARCHAR(16) NOT NULL,
    rule_code VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'open',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (animal_id) REFERENCES animal_profile(animal_id),
    FOREIGN KEY (reading_id) REFERENCES thermal_reading(reading_id)
);

CREATE TABLE gateway_control_log (
    command_id VARCHAR(36) PRIMARY KEY,
    gateway_id VARCHAR(36) NOT NULL,
    command_name VARCHAR(64) NOT NULL,
    requested_at DATETIME NOT NULL,
    acknowledged_at DATETIME,
    status VARCHAR(32) NOT NULL
);
