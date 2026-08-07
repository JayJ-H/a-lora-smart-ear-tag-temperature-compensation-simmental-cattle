# MySQL setup

Run from the repository root:

```bash
docker compose -f backend/database/mysql/docker-compose.yml up -d
```

The initial database chain applies:

- `backend/database/mysql/init/001_init_schema.sql`
- `backend/database/mysql/init/002_event_sync_triggers.sql`

Connection values are supplied through the environment variables used by the
compose file. To inspect the initialized schema:

```bash
docker exec -it cattle-mysql mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" -D cattle_management -e "SHOW TABLES;"
```

The local MySQL alternative is:

```bash
mysql -uroot -p < backend/database/mysql/init/001_init_schema.sql
```

Frontend table names with hyphens map to MySQL names with underscores, for
example `milk-records` to `milk_records` and `kpi-dashboard-data` to
`kpi_dashboard_data`. Nested payloads use `JSON` columns.

Canonical tables are `animal`, `milk_measurement`, `sensor_reading`, and
`operation_audit_log`; compatibility projections use the corresponding legacy
plural names. Field mappings are documented in `DATA_DICTIONARY.md`.
