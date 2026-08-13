# MySQL 初始化说明

## 1. 启动数据库

在项目根目录执行：

```bash
docker compose -f database/mysql/docker-compose.yml up -d
```

首次启动会自动执行：

- `database/mysql/init/001_init_schema.sql`
- `database/mysql/init/002_event_sync_triggers.sql`

## 2. 连接信息

- Host: `127.0.0.1`
- Port: `3306`
- DB: `cattle_management`
- User: set `MYSQL_USER` privately; packaged value is redacted.
- Password: set `MYSQL_PASSWORD` privately; packaged value is redacted.
- Root Password: set `MYSQL_ROOT_PASSWORD` privately; packaged value is redacted.

## 3. 快速验证

```bash
docker exec -it cattle-mysql mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" -D cattle_management -e "SHOW TABLES;"
```

## 3.1 无 Docker 时（本机 MySQL）

```bash
mysql -uroot -p < database/mysql/init/001_init_schema.sql
```

## 4. 命名约定

- 前端 Dexie 表名中的连字符统一转换为下划线：
  - `transfer-reasons` -> `transfer_reasons`
  - `milk-records` -> `milk_records`
  - `kpi-dashboard-data` -> `kpi_dashboard_data`
- 复杂嵌套字段统一使用 `JSON` 列，便于先跑通接口开发。

## 4.1 数据模型收敛约定

第一阶段收敛口径见 `database/mysql/DATA_DICTIONARY.md`。

- `animal` 是唯一动物主档；`cows` 只作为旧前端和旧 RPC 的兼容只读投影。
- 标准动物字段为 `animal_id` / `animal_number`；兼容字段为 `cow_id` / `cow_number`。
- 双轨事实表以 v2 单数表为 canonical：
  - `milk_measurement` 为奶量事实表，`milk_records` 为兼容表/投影。
  - `sensor_reading` 为传感器读数事实表，`sensor_readings` 为兼容表/投影。
  - `operation_audit_log` 为操作审计事实表，`operation_audit_logs` 为兼容表/投影。
- `database/mysql/migrations/030_model_convergence_dry_run.sql` 只包含只读检测和迁移建议，不应在生产库直接执行写入迁移。

## 5. 后续建议

- 先完成后端 CRUD 接口（牛只、入群/转群/出群、人员、圈舍）。
- 稳定后再把 `JSON` 字段逐步拆分成强约束子表。
