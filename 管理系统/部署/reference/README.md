# Reference deployment (not production-validated)

This directory documents a Docker-based production-style deployment. It is
included for inspection and future migration, but it was not executed as a
remote production installation for this release. The verified local path is
`管理系统/源代码/脚本/start-local-platform.ps1` (Windows) or
`start-local-platform.sh` (Linux); that path uses a local MySQL container and
the live TH-SHRC MQTT smoke check.

This directory turns the current platform into a cloud-migration-ready four-service deployment:

- `mysql`: persistent MySQL 8.4 database.
- `api`: Node/Express backend with built-in MQTT broker.
- `web`: Nginx static frontend plus `/api` reverse proxy.
- `mqtt-replay-control`: standalone MQTT replay control page on its own port.
- `caddy`: HTTPS gateway for `REDACTED_SERVER_HOST` and `control.REDACTED_SERVER_HOST`.

## First launch

```powershell
Copy-Item 运维/生产配置/.env.prod.example 运维/生产配置/.env.prod
# Edit 运维/生产配置/.env.prod and replace every password.
docker compose --env-file 运维/生产配置/.env.prod -f 运维/生产配置/docker-compose.prod.yml up -d --build
docker compose --env-file 运维/生产配置/.env.prod -f 运维/生产配置/docker-compose.prod.yml -f 运维/生产配置/docker-compose.remote.yml up -d
```

The API container runs `脚本/seed-production-min-config.mjs` before starting the backend. On a fresh MySQL volume this creates deterministic production baseline data for milking parlor devices, lactation sensors, production-database synchronization, reproduction records and omics breeding analysis. The baseline is recorded in `production_baseline_manifest` with source type `deterministic_production_seed`.

Open:

```text
http://<server-ip>:9191/
```

HTTPS:

```text
https://REDACTED_SERVER_HOST/
https://control.REDACTED_SERVER_HOST/
```

Standalone replay control:

```text
http://<server-ip>:9194/
```

The database is only published on host loopback by default:

```text
127.0.0.1:9193
```

## Checks

```powershell
docker compose --env-file 运维/生产配置/.env.prod -f 运维/生产配置/docker-compose.prod.yml ps
$env:PRODUCTION_BASE_URL="http://127.0.0.1:9191"; `
$env:PRODUCTION_ADMIN_USER="admin"; `
$env:PRODUCTION_ADMIN_PASSWORD="<your-admin-password>"; `
node 脚本/check-production-system.mjs
node 脚本/audit-real-db-coverage.mjs
```

## Backup

```powershell
powershell -ExecutionPolicy Bypass -File 脚本/backup-mysql.ps1
```

Backups are written under `backups/`.

## Published ports

- `9191/tcp`: platform web
- `9192/tcp`: backend API
- `9193/tcp`: MySQL host mapping, bound to `127.0.0.1` by default
- `9194/tcp`: standalone MQTT replay control page
- `9195/tcp`: MQTT broker

## MQTT ingestion

Production starts an MQTT broker in the API container when `MQTT_ENABLED=true`.

Default endpoint:

```text
mqtt://<server-ip>:9195
```

Default topic:

```text
cattle/{cowNumber}/temperature
```

Recommended JSON payload:

```json
{
  "messageId": "gw-20260522-0001",
  "cowNumber": "52",
  "timestamp": "2026-05-22T10:30:00+08:00",
  "earTemperature": 38.6,
  "rectalTemperature": 39.8,
  "airTemperature": 35.5,
  "signalStrength": 126
}
```

The backend also accepts ThingsCloud-style text:

```text
牛号：52 牛体温：38.6℃ 环境温度：35.5℃ 信号强度：126
```

Messages are written to `sensors`. High-temperature records create active `alerts`.

## Compose validation

```powershell
docker compose --env-file 运维/生产配置/.env.prod -f 运维/生产配置/docker-compose.prod.yml config
```

## Launch judgement

Suitable first production target:

- Intranet or VPN deployment.
- One server or workstation with Docker.
- MySQL volume backup enabled.
- ThingsCloud data still imported by batch script or controlled job.

Do not expose this directly to the public Internet until these are done:

- Replace broad maintenance RPC access with role-level API permissions.
- Move passwords to server-side secret management.
- Add live ingestion and alert audit records.
- Continue narrowing maintenance-only pages behind role permissions.
