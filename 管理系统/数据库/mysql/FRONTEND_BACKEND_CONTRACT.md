# 前后端数据库接口

前端通过以下 RPC 接口访问数据库：

```text
POST /api/db/rpc
Content-Type: application/json
```

请求示例：

```json
{"method":"getTableData","tableName":"cows"}
```

响应示例：

```json
{"code":200,"msg":"success","data":[]}
```

## RPC方法

| 方法 | 请求字段 | 返回值 |
| --- | --- | --- |
| `getTableData` | `tableName` | `any[]` |
| `updateTableData` | `tableName`、`data` | `boolean` |
| `addTableData` | `tableName`、`data` | `boolean` |
| `updateTableRecord` | `tableName`、`id`、`updatedRecord` | `boolean` |
| `deleteTableRecord` | `tableName`、`id` | `boolean` |
| `clearTableData` | `tableName` | `boolean` |
| `getDataStats` | 无 | `Record<string, number>` |
| `resetDatabase` | 无 | `boolean` |

前端带连字符的表名映射为 MySQL 下划线表名。业务接口使用
`/api/cow/{scope}/{method}`，`scope` 包括 `cow`、`sensor`、`event`、
`baseData`、`statistics`、`export`、`milk`、`feed`、`reproduction`、`health`、
`automation`、`economic`、`predictive`、`hardware` 和 `kpi`。
