# 数据模型与字段字典

平台以 `animal` 作为规范动物主表，相关业务表通过 `animal_id` 引用
`animal.id`；兼容接口可使用 `cow_id` 和 `cow_number`。

## 规范表

- `animal`：动物主档。
- `milk_measurement`：奶量事实表。
- `sensor_reading`：传感器读数事实表。
- `operation_audit_log`：操作审计事实表。

`cows`、`milk_records`、`sensor_readings` 和 `operation_audit_logs` 为现有
接口使用的兼容投影。

## 常用字段

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `animal.id` | `VARCHAR(64)` | 系统内动物标识。 |
| `animal.animal_number` | `VARCHAR(64)` | 业务牛号。 |
| `animal.ear_tag_number` | `VARCHAR(64)` | 耳标号。 |
| `animal.electronic_tag` | `VARCHAR(64)` | 电子标签或设备绑定标识。 |
| `animal.breed` | `VARCHAR(128)` | 品种。 |
| `animal.sex` | `VARCHAR(16)` | 标准性别字段。 |
| `animal.birth_date` | `DATE` | 出生日期。 |
| `animal.status` | `VARCHAR(32)` | 动物状态。 |
| `created_at`、`updated_at` | `DATETIME(3)` | 记录时间。 |
| JSON扩展字段 | `JSON` | 原始负载和扩展指标。 |

## 传感器读数字段

| 兼容字段 | 规范字段 |
| --- | --- |
| `cow_id` | `animal_id` |
| `device_id` | `device_id` |
| `metric` 或 `type` | `metric_code` |
| `value` | `reading_value` |
| `text_value` | `reading_text` |
| `timestamp` 或 `ts` | `measured_at` |
| `payload` | `raw_payload` |

## 操作审计字段

| 字段 | 含义 |
| --- | --- |
| `action_type` | 操作类型。 |
| `target_type` | 目标表或资源。 |
| `target_id` | 目标记录。 |
| `animal_id` | 关联动物。 |
| `operator_name` | 操作人。 |
| `operated_at` | 操作时间。 |
| `request_payload` | 请求负载。 |
| `result_payload` | 结果负载。 |
| `status` | 操作状态。 |
