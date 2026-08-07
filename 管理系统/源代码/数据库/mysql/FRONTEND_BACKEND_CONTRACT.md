# 前后端数据库接口

前端通过 `POST /api/db/rpc` 发送 JSON 请求体。

```json
{"method":"getTableData","tableName":"cows"}
```

响应格式：

```json
{"code":200,"msg":"success","data":[]}
```

支持的方法为 `getTableData`、`updateTableData`、`addTableData`、
`updateTableRecord`、`deleteTableRecord`、`clearTableData`、`getDataStats` 和
`resetDatabase`。请求字段和返回类型由 `脚本/` 中的处理器实现。

前端带连字符的表名映射为 MySQL 下划线表名。业务接口使用
`/api/cow/{scope}/{method}`，`scope` 包括 `cow`、`sensor`、`event`、
`baseData`、`statistics`、`export`、`milk`、`feed`、`reproduction`、`health`、
`automation`、`economic`、`predictive`、`hardware` 和 `kpi`。
