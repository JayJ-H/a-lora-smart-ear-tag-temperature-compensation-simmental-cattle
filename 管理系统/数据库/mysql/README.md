# MySQL配置

在仓库根目录执行：

```bash
docker compose -f 管理系统/数据库/mysql/docker-compose.yml up -d
```

首次启动执行：

- `管理系统/数据库/mysql/init/001_init_schema.sql`
- `管理系统/数据库/mysql/init/002_event_sync_triggers.sql`

连接参数由 compose 文件使用的环境变量提供。查看初始化后的表：

```bash
docker exec -it cattle-mysql mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" -D cattle_management -e "SHOW TABLES;"
```

本机 MySQL 初始化命令：

```bash
mysql -uroot -p < 管理系统/数据库/mysql/init/001_init_schema.sql
```

前端带连字符的表名映射为 MySQL 下划线表名，例如
`milk-records` 映射为 `milk_records`，`kpi-dashboard-data` 映射为
`kpi_dashboard_data`。嵌套负载使用 `JSON` 字段。

规范表为 `animal`、`milk_measurement`、`sensor_reading` 和
`operation_audit_log`；复数表名为兼容投影。字段映射见
`管理系统/数据库/mysql/DATA_DICTIONARY.md`。
