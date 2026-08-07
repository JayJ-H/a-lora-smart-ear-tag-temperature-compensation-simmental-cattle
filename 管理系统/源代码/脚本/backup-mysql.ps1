param(
  [string]$ComposeFile = "运维/生产配置/docker-compose.prod.yml",
  [string]$EnvFile = "运维/生产配置/.env.prod",
  [string]$OutputDir = "backups"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$ComposePath = Join-Path $Root $ComposeFile
$EnvPath = Join-Path $Root $EnvFile
$BackupDir = Join-Path $Root $OutputDir

if (-not (Test-Path $ComposePath)) {
  throw "Compose file not found: $ComposePath"
}

if (-not (Test-Path $EnvPath)) {
  throw "Env file not found: $EnvPath"
}

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupFile = Join-Path $BackupDir "cattle_management_$timestamp.sql"

$dump = & docker compose --env-file $EnvPath -f $ComposePath exec -T mysql sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' 2>&1
if ($LASTEXITCODE -ne 0) {
  throw "mysqldump failed: $dump"
}

$dump | Set-Content -Path $backupFile -Encoding UTF8
Write-Host "Backup written: $backupFile"
