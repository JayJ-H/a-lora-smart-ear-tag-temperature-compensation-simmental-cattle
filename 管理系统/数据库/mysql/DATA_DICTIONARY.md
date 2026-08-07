# 数据模型与字段字典

平台以 `animal` 作为规范动物主表，相关业务表通过 `animal_id` 引用
`animal.id`；兼容接口可使用 `cow_id` 和 `cow_number`。

## 动物字段

| 字段 | 类型 | 约束 | 含义 |
| --- | --- | --- | --- |
| `animal.id` | `VARCHAR(64)` | PK | 系统内动物标识。 |
| `animal.animal_number` | `VARCHAR(64)` | UNIQUE, NOT NULL | 业务牛号。 |
| `animal.ear_tag_number` | `VARCHAR(64)` | 可空 | 耳标号。 |
| `animal.electronic_tag` | `VARCHAR(64)` | 可空 | 电子标签或设备绑定标识。 |
| `animal.name` | `VARCHAR(128)` | 可空 | 显示名称。 |
| `animal.species` | `VARCHAR(64)` | NOT NULL | 物种，默认 `cattle`。 |
| `animal.breed` | `VARCHAR(128)` | 可空 | 品种。 |
| `animal.sex` | `VARCHAR(16)` | NOT NULL | 标准性别字段，兼容视图映射为 `gender`。 |
| `animal.birth_date` | `DATE` | 可空 | 出生日期。 |
| `animal.entry_date` | `DATE` | 可空 | 入场日期。 |
| `animal.source_farm` | `VARCHAR(128)` | 可空 | 来源牧场。 |
| `animal.current_stage_id` | `VARCHAR(64)` | 可空 | 当前生产阶段。 |
| `animal.current_group_id` | `VARCHAR(64)` | 可空 | 当前牛群。 |
| `animal.current_unit_id` | `VARCHAR(64)` | 可空 | 场区或单元。 |
| `animal.current_pen_id` | `VARCHAR(64)` | 可空 | 栏舍。 |
| `animal.status` | `VARCHAR(32)` | NOT NULL | `active`、`left`、`dead` 或 `sold`。 |
| `animal.genetic_line` | `VARCHAR(128)` | 可空 | 家系或遗传系。 |
| `animal.production_purpose` | `VARCHAR(64)` | 可空 | 生产用途。 |
| `created_at`、`updated_at` | `DATETIME(3)` | 可空 | 记录时间。 |
| JSON扩展字段 | `JSON` | 可空 | 原始负载和扩展指标。 |

## 兼容投影

| 兼容字段 | 规范来源 |
| --- | --- |
| `cows.id` | `animal.id` |
| `cows.cow_number` | `animal.animal_number` |
| `cows.ear_tag_number` | `animal.ear_tag_number` |
| `cows.breed` | `animal.breed` |
| `cows.gender` | `animal.sex` |
| `cows.birth_date` | `animal.birth_date` |
| `cows.status` | `animal.status` |
| `cows.father_number`、`cows.mother_number` | `animal_parentage.parent_number` |
| `cows.parity` | `parity_episode` |
| `cows.created_at`、`cows.updated_at` | `animal.created_at`、`animal.updated_at` |

## 事实表

- `milk_measurement`：奶量事实表；`milk_records` 为兼容投影。
- `sensor_reading`：传感器读数事实表；`sensor_readings` 为兼容投影。
- `operation_audit_log`：操作审计事实表；`operation_audit_logs` 为兼容投影。

规范表使用 `utf8mb4` 字符集。完整表结构见本目录中的 SQL 文件。
