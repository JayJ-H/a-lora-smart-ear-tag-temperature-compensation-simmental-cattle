# Frontend-Backend Contract (Database)

前端已切换为 `管理系统` 模式，统一通过 RPC 访问数据库。

## 1. 基础约定

- URL: `/api/db/rpc`
- Method: `POST`
- Content-Type: `application/json`
- 请求体:

```json
{
  "method": "getTableData",
  "tableName": "cows"
}
```

- 响应体（需符合项目 axios 封装）:

```json
{
  "code": 200,
  "msg": "success",
  "数据": []
}
```

## 2. 需要实现的 method

- `getTableData`
  - 入参: `{ tableName: string }`
  - 返回: `any[]`
- `updateTableData`
  - 入参: `{ tableName: string, data: any[] }`
  - 返回: `boolean`
- `addTableData`
  - 入参: `{ tableName: string, data: any[] }`
  - 返回: `boolean`
- `updateTableRecord`
  - 入参: `{ tableName: string, id: string, updatedRecord: any }`
  - 返回: `boolean`
- `deleteTableRecord`
  - 入参: `{ tableName: string, id: string }`
  - 返回: `boolean`
- `clearTableData`
  - 入参: `{ tableName: string }`
  - 返回: `boolean`
- `getDataStats`
  - 入参: `{}`
  - 返回: `Record<string, number>`
- `resetDatabase`
  - 入参: `{}`
  - 返回: `boolean`

## 3. 表名映射

前端表名使用连字符，MySQL 使用下划线。后端建议做映射：

- `transfer-reasons` -> `transfer_reasons`
- `milk-records` -> `milk_records`
- `milk-quality-standards` -> `milk_quality_standards`
- `kpi-dashboard-data` -> `kpi_dashboard_data`
- 其他同理

## 3.1 模型收敛映射

第一阶段数据模型以 `数据库/mysql/DATA_DICTIONARY.md` 为准：

- `animal` 是唯一动物主档；`cows` 在后端契约中只保留为兼容只读投影。
- 标准字段使用 `animal_id`、`animal_number`；旧前端字段 `cow_id`、`cow_number` 由后端兼容层投影。
- `getTableData({ tableName: "cows" })` 可返回 `animal` 投影字段；写方法不应把 `cows` 当作新的主档写入。
- 表名双轨收敛规则：

| 业务域 | Canonical 表 | 兼容表名 | 说明 |
| --- | --- | --- | --- |
| 动物主档 | `animal` | `cows` | `cows` 只读投影，字段映射见数据字典。 |
| 奶量事实 | `milk_measurement` | `milk_records` / `milk-records` | 旧接口继续读兼容表，迁移后应由 canonical 生成。 |
| 传感器读数 | `sensor_reading` | `sensor_readings` / `sensor-readings` | 兼容复数表名，不作为新写入口。 |
| 操作审计 | `operation_audit_log` | `operation_audit_logs` | 审计写入口需要在真实迁移授权后统一。 |

兼容投影的写入、清空、重置操作必须由后端显式拒绝或转换到 canonical 写入路径；第一阶段审计脚本只检测，不修复数据。

## 4. cow API 代理约定

前端 `src/api/cow.ts` 在 backend 模式下会把调用转发到：

- `/api/cow/{scope}/{method}`

其中 `scope` 包括：

- `cow`, `sensor`, `event`, `baseData`, `statistics`, `export`
- `milk`, `feed`, `reproduction`, `health`, `automation`
- `economic`, `predictive`, `硬件`, `kpi`

请求体:

```json
{
  "args": [ ... ]
}
```
