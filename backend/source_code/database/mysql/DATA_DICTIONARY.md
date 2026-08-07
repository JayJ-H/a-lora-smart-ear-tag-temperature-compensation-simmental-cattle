# Data model and field dictionary

The platform uses `animal` as the canonical animal table. Related business
tables reference `animal.id` through `animal_id`; compatibility interfaces may
expose `cow_id` and `cow_number`.

## Canonical tables

- `animal`: animal master table.
- `milk_measurement`: milk-yield fact table.
- `sensor_reading`: sensor-reading fact table.
- `operation_audit_log`: operation-audit fact table.

The plural table names `cows`, `milk_records`, `sensor_readings`, and
`operation_audit_logs` are compatibility projections used by existing API
paths.

## Common fields

| Field | Type | Meaning |
| --- | --- | --- |
| `animal.id` | `VARCHAR(64)` | Internal animal identifier. |
| `animal.animal_number` | `VARCHAR(64)` | Farm-facing animal number. |
| `animal.ear_tag_number` | `VARCHAR(64)` | Ear-tag number. |
| `animal.electronic_tag` | `VARCHAR(64)` | Electronic tag or device binding. |
| `animal.breed` | `VARCHAR(128)` | Breed. |
| `animal.sex` | `VARCHAR(16)` | Standard sex field. |
| `animal.birth_date` | `DATE` | Birth date. |
| `animal.status` | `VARCHAR(32)` | Animal status. |
| `created_at`, `updated_at` | `DATETIME(3)` | Record timestamps. |
| JSON extension fields | `JSON` | Raw payload and extended metrics. |

## Sensor-reading fields

| Compatibility field | Canonical field |
| --- | --- |
| `cow_id` | `animal_id` |
| `device_id` | `device_id` |
| `metric` or `type` | `metric_code` |
| `value` | `reading_value` |
| `text_value` | `reading_text` |
| `timestamp` or `ts` | `measured_at` |
| `payload` | `raw_payload` |

## Operation-audit fields

| Field | Meaning |
| --- | --- |
| `action_type` | Operation type. |
| `target_type` | Target table or resource. |
| `target_id` | Target record. |
| `animal_id` | Related animal. |
| `operator_name` | Operator. |
| `operated_at` | Operation time. |
| `request_payload` | Request payload. |
| `result_payload` | Result payload. |
| `status` | Operation status. |
