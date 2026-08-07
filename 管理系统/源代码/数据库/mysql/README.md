# MySQL配置

从仓库根目录创建 `.env` 并启动 MySQL：

```powershell
Copy-Item .env.example .env
docker compose --env-file .env -f 管理系统/源代码/数据库/mysql/docker-compose.local.yml up -d
```

首次启动执行 `init/001_init_schema.sql` 和 `init/002_event_sync_triggers.sql`。
规范动物表为 `animal`，`cows` 为兼容投影；规范事实表为
`milk_measurement`、`sensor_reading` 和 `operation_audit_log`。
