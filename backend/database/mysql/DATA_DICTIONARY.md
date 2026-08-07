# Data model and field dictionary

The platform uses `animal` as the canonical animal table. Related business
tables reference `animal.id` through `animal_id`; compatibility interfaces may
expose `cow_id` and `cow_number`.

## Animal fields

| Field | Type | Constraint | Meaning |
| --- | --- | --- | --- |
| `animal.id` | `VARCHAR(64)` | PK | Internal animal identifier. |
| `animal.animal_number` | `VARCHAR(64)` | UNIQUE, NOT NULL | Farm-facing animal number. |
| `animal.ear_tag_number` | `VARCHAR(64)` | nullable | Ear-tag number. |
| `animal.electronic_tag` | `VARCHAR(64)` | nullable | Electronic tag or device binding. |
| `animal.name` | `VARCHAR(128)` | nullable | Display name. |
| `animal.species` | `VARCHAR(64)` | NOT NULL | Species; default `cattle`. |
| `animal.breed` | `VARCHAR(128)` | nullable | Breed. |
| `animal.sex` | `VARCHAR(16)` | NOT NULL | Standard sex field; exposed as `gender` by compatibility views. |
| `animal.birth_date` | `DATE` | nullable | Birth date. |
| `animal.entry_date` | `DATE` | nullable | Entry date. |
| `animal.source_farm` | `VARCHAR(128)` | nullable | Source farm. |
| `animal.current_stage_id` | `VARCHAR(64)` | nullable | Production stage. |
| `animal.current_group_id` | `VARCHAR(64)` | nullable | Herd or group. |
| `animal.current_unit_id` | `VARCHAR(64)` | nullable | Farm unit. |
| `animal.current_pen_id` | `VARCHAR(64)` | nullable | Pen. |
| `animal.status` | `VARCHAR(32)` | NOT NULL | `active`, `left`, `dead`, or `sold`. |
| `animal.genetic_line` | `VARCHAR(128)` | nullable | Genetic line. |
| `animal.production_purpose` | `VARCHAR(64)` | nullable | Production purpose. |
| `created_at`, `updated_at` | `DATETIME(3)` | nullable | Record timestamps. |
| JSON extension fields | `JSON` | nullable | Raw payload and extended metrics. |

## Compatibility projections

| Compatibility field | Canonical source |
| --- | --- |
| `cows.id` | `animal.id` |
| `cows.cow_number` | `animal.animal_number` |
| `cows.ear_tag_number` | `animal.ear_tag_number` |
| `cows.breed` | `animal.breed` |
| `cows.gender` | `animal.sex` |
| `cows.birth_date` | `animal.birth_date` |
| `cows.status` | `animal.status` |
| `cows.father_number`, `cows.mother_number` | `animal_parentage.parent_number` |
| `cows.parity` | `parity_episode` |
| `cows.created_at`, `cows.updated_at` | `animal.created_at`, `animal.updated_at` |

## Fact tables

- `milk_measurement` is the canonical milk-yield fact table; `milk_records` is
  its compatibility projection.
- `sensor_reading` is the canonical sensor-reading fact table;
  `sensor_readings` is its compatibility projection.
- `operation_audit_log` is the canonical operation-audit fact table;
  `operation_audit_logs` is its compatibility projection.

The canonical tables use `utf8mb4` character storage. Complete table and column
definitions are in the SQL files in this directory.
