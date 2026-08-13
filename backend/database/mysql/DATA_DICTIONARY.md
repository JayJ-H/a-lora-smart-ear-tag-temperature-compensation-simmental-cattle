# 数据模型收敛数据字典

本文档定义水牛育种平台第一阶段的数据模型收敛口径。第一阶段只做字典、只读检测和幂等迁移方案，不直接改生产数据。

## 1. 主档原则

- `animal` 是唯一动物主档，是后续育种、泌乳、传感器、事件、审计等业务表引用的 canonical source。
- `cows` 只作为兼容只读投影存在，用于旧 Dexie 表名、旧 RPC 表名和仍未迁移完成的前端视图。
- 新增业务表统一使用 `animal_id` 引用 `animal.id`；兼容层可继续暴露 `cow_id`、`cow_number`。
- `cow_number` 是兼容字段名，标准字段名是 `animal_number`。
- 收敛后禁止在 `animal` 与 `cows` 之间形成双写主档。写入口只能落到 `animal` 或授权的 canonical 子表，再由视图或投影向旧接口提供兼容数据。

## 2. 字段标准

| 标准字段 | 类型建议 | 约束 | 说明 |
| --- | --- | --- | --- |
| `animal.id` | `VARCHAR(64)` | PK | 系统内动物唯一 ID。 |
| `animal.animal_number` | `VARCHAR(64)` | UNIQUE, NOT NULL | 业务牛号；兼容层映射为 `cow_number`。 |
| `animal.ear_tag_number` | `VARCHAR(64)` | 可唯一 | 耳标号，空值允许。 |
| `animal.electronic_tag` | `VARCHAR(64)` | 可唯一 | 电子标签或设备绑定标识。 |
| `animal.name` | `VARCHAR(128)` | NULL | 展示名。 |
| `animal.species` | `VARCHAR(64)` | NOT NULL | 默认 `水牛`。 |
| `animal.breed` | `VARCHAR(128)` | NULL | 品种。 |
| `animal.sex` | `VARCHAR(16)` | NOT NULL | 标准性别字段；兼容层映射为 `gender`。 |
| `animal.birth_date` | `DATE` | NULL | 出生日期。 |
| `animal.entry_date` | `DATE` | NULL | 入场日期。 |
| `animal.source_farm` | `VARCHAR(128)` | NULL | 来源场。 |
| `animal.current_stage_id` | `VARCHAR(64)` | FK candidate | 当前生产阶段。 |
| `animal.current_group_id` | `VARCHAR(64)` | FK candidate | 当前牛群。 |
| `animal.current_unit_id` | `VARCHAR(64)` | FK candidate | 当前场区/单元。 |
| `animal.current_pen_id` | `VARCHAR(64)` | FK candidate | 当前栏舍。 |
| `animal.status` | `VARCHAR(32)` | NOT NULL | `active`、`left`、`dead`、`sold` 等状态。 |
| `animal.genetic_line` | `VARCHAR(128)` | NULL | 家系/遗传系。 |
| `animal.production_purpose` | `VARCHAR(64)` | NULL | 生产用途。 |
| `created_at` / `updated_at` | `DATETIME(3)` | NULL/NOT NULL | 统一毫秒精度。 |
| JSON 字段 | `JSON` | NULL | 保留原始负载、扩展指标、迁移证据。 |

字符集统一为 `utf8mb4`。v2 canonical DDL 当前采用 `utf8mb4_unicode_ci`；历史 v1 初始化脚本采用 `utf8mb4_0900_ai_ci`。真实收敛前必须先审计并统一 join 相关表和文本列的 collation。

## 3. `animal` 到 `cows` 兼容映射

| `cows` 兼容字段 | `animal`/canonical 来源 | 说明 |
| --- | --- | --- |
| `id` | `animal.id` | 同一动物 ID。 |
| `cow_number` | `animal.animal_number` | 旧前端牛号字段。 |
| `ear_tag_number` | `animal.ear_tag_number` | 直接投影。 |
| `breed` | `animal.breed` | 直接投影。 |
| `gender` | `animal.sex` | 字段名兼容。 |
| `birth_date` | `animal.birth_date` | 直接投影。 |
| `cow_type` | `stage_definition.name` 或 `animal.current_stage_id` | 未解析阶段字典时可返回阶段 ID。 |
| `current_pen` | `farm_unit.name` 或 `animal.current_pen_id` | 未解析栏舍字典时可返回栏舍 ID。 |
| `status` | `animal.status` | 直接投影。 |
| `father_number` / `mother_number` | `animal_parentage.parent_number` | 按 `parent_role` 投影。 |
| `grandfather_number` / `grandmother_number` | `animal_parentage` 递归解析 | 第一阶段只定义映射，不自动回填。 |
| `pregnancy` | `reproduction_cycle` / `animal_event` | 兼容布尔投影；canonical 不放入主档。 |
| `mixing` | `animal_group_membership` / 事件 | 兼容布尔投影；canonical 不放入主档。 |
| `parity` | `parity_episode` | 当前胎次投影。 |
| `created_at` / `updated_at` | `animal.created_at` / `animal.updated_at` | 直接投影。 |

兼容投影只能用于读。旧接口需要写入时，应由应用层转换成 canonical 写入请求，并在真实迁移授权后完成。

## 4. 双轨表收敛口径

### 4.1 奶量：`milk_measurement` / `milk_records`

- Canonical 表：`milk_measurement`
- 兼容表/投影：`milk_records`
- 标准引用：`milk_measurement.animal_id -> animal.id`

| `milk_records` 兼容字段 | `milk_measurement` 标准字段 | 说明 |
| --- | --- | --- |
| `id` | `id` 或迁移生成 ID | 保持可追溯。 |
| `cow_id` | `animal_id` | 字段名兼容。 |
| `milking_time` | `measured_at` | 标准测量时间。 |
| `volume` | `milk_yield` | 单位需由 `unit` 或业务约定确认，默认 kg/L 口径需在迁移前锁定。 |
| `milk_quality` | 质量字段与 `raw_payload` | fat/protein/SCC 等拆列后，原始质量 JSON 可保留。 |
| `equipment_id` | `visit_id`/设备链路 | 通过 `milking_visit`、`milking_session` 或设备维表解析。 |
| `source_table` / `source_record_id` | 迁移追踪字段 | 用于幂等比对和回放。 |

收敛策略：先建立 `milk_records` 到 `milk_measurement` 的可重复映射，补齐 `animal_id`、时间、奶量、来源记录 ID；比对行数和自然键；授权后再把旧读入口切换为只读视图。

### 4.2 传感器：`sensor_reading` / `sensor_readings`

- Canonical 表：`sensor_reading`
- 兼容表/投影：`sensor_readings`
- 标准引用：`sensor_reading.animal_id -> animal.id`

| `sensor_readings` 兼容字段 | `sensor_reading` 标准字段 | 说明 |
| --- | --- | --- |
| `id` | `id` | 同一读数 ID 或迁移生成 ID。 |
| `cow_id` | `animal_id` | 兼容字段名。 |
| `device_id` | `device_id` | 设备 ID。 |
| `metric` / `type` | `metric_code` | 指标代码。 |
| `value` | `reading_value` | 数值型读数。 |
| `text_value` | `reading_text` | 文本型读数。 |
| `unit` | `unit` | 单位。 |
| `timestamp` / `ts` | `measured_at` | 标准测量时间。 |
| `payload` | `raw_payload` | 原始设备负载。 |

收敛策略：保留 `sensor_reading` 为唯一事实表；`sensor_readings` 只作为旧表名兼容。真实迁移前需先确认设备 ID、指标代码、时间戳和 `animal_id` 的唯一自然键。

### 4.3 审计：`operation_audit_log` / `operation_audit_logs`

- Canonical 表：`operation_audit_log`
- 兼容表/投影：`operation_audit_logs`
- 标准引用：`operation_audit_log.animal_id -> animal.id`

| `operation_audit_logs` 兼容字段 | `operation_audit_log` 标准字段 | 说明 |
| --- | --- | --- |
| `id` | `id` | 审计记录 ID。 |
| `action_type` | `action_type` | 操作类型。 |
| `target_type` | `target_type` | 目标表/资源。 |
| `target_id` | `target_id` | 目标记录。 |
| `cow_id` | `animal_id` | 旧字段如存在则转换。 |
| `operator_name` | `operator_name` | 操作人。 |
| `created_at` | `operated_at` 或 `created_at` | 旧兼容可返回创建时间。 |
| `request_payload` | `request_payload` | 请求负载。 |
| `result_payload` | `result_payload` | 结果负载。 |
| `status` | `status` | 操作状态。 |

收敛策略：审计表必须先解决 canonical 与 plural 表的写入口归属。授权前只检测两边计数、ID 重叠、目标记录可解析性和 `animal_id` 可追溯性。

## 5. 幂等迁移前置条件

- `animal.animal_number` 与 `cows.cow_number` 无重复、无空值、无互相冲突。
- 所有引用动物的业务表能通过 `animal_id` 或兼容 `cow_id/cow_number` 解析到 `animal.id`。
- 双轨表完成自然键定义，并能证明 canonical 表覆盖旧表数据。
- 文本列 collation 在 join 相关表之间一致。
- 迁移脚本必须可重复执行，使用来源表、来源记录 ID、批次号或自然键防重。
- 真实迁移前需要完整备份、业务写入冻结窗口和回滚方案。
