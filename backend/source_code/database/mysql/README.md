# MySQL setup

Create `.env` from the repository-level `.env.example`, set the required
passwords, and start MySQL from the repository root:

```powershell
Copy-Item .env.example .env
docker compose --env-file .env -f backend/source_code/database/mysql/docker-compose.local.yml up -d
```

The initial database chain applies `init/001_init_schema.sql` and
`init/002_event_sync_triggers.sql`. The canonical animal table is `animal`;
`cows` is the compatibility projection. Canonical fact tables are
`milk_measurement`, `sensor_reading`, and `operation_audit_log`.
