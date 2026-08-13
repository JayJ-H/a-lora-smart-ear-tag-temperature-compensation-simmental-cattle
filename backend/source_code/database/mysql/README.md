# MySQL setup

Create `.env` from the repository-level `.env.example`, set the required
passwords, and start MySQL from the repository root:

```powershell
Copy-Item .env.example .env
docker compose --env-file .env -f database/mysql/docker-compose.local.yml up -d
```

The first start applies `init/001_init_schema.sql` and
`init/002_event_sync_triggers.sql`. The public compose files do not contain
default credentials or seed cattle records.

The canonical animal table is `animal`; `cows` remains a compatibility
projection for older frontend and RPC paths. Canonical fact tables use the
singular names `milk_measurement`, `sensor_reading`, and
`operation_audit_log`.
