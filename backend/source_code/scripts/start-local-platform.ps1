param(
  [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$LogDir = Join-Path $Root 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Require-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' was not found on PATH."
  }
}

function Set-DefaultEnv {
  param([string]$Name, [string]$Value)
  $current = [Environment]::GetEnvironmentVariable($Name, 'Process')
  if ([string]::IsNullOrWhiteSpace($current)) {
    Set-Item -Path "Env:$Name" -Value $Value
  }
}

function Test-PortAvailable {
  param([int]$Port)
  try {
    $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop
    return -not [bool]$listener
  } catch {
    return $true
  }
}

function Select-LocalPort {
  param([int]$Requested, [int]$Fallback, [int[]]$Reserved = @())
  if (($Reserved -notcontains $Requested) -and (Test-PortAvailable $Requested)) { return $Requested }
  $candidate = $Fallback
  while (($Reserved -contains $candidate) -or (-not (Test-PortAvailable $candidate))) { $candidate += 1 }
  return $candidate
}

function Get-NodeProcess {
  Get-CimInstance Win32_Process -Filter "name = 'node.exe'" -ErrorAction SilentlyContinue
}

function Has-ProcessCommand {
  param([string]$Pattern)
  return [bool](Get-NodeProcess | Where-Object { $_.CommandLine -match $Pattern })
}

function Ensure-DockerDesktop {
  Require-Command 'docker'
  $dockerDesktop = Get-Process 'Docker Desktop' -ErrorAction SilentlyContinue
  if (-not $dockerDesktop) {
    $dockerDesktopPath = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
    if (Test-Path $dockerDesktopPath) {
      Start-Process -FilePath $dockerDesktopPath -WindowStyle Hidden
    }
  }

  $deadline = (Get-Date).AddSeconds(120)
  do {
    docker version *> $null
    if ($LASTEXITCODE -eq 0) { return }
    Start-Sleep -Seconds 3
  } while ((Get-Date) -lt $deadline)

  throw 'Docker Desktop engine is not ready. Start Docker Desktop and run this script again.'
}

function Wait-Http {
  param(
    [string]$Url,
    [int]$TimeoutSeconds = 60
  )
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 3
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { return }
    } catch {
      Start-Sleep -Seconds 2
    }
  } while ((Get-Date) -lt $deadline)
  throw "Timed out waiting for $Url"
}

Set-Location $Root
Require-Command 'node'
$nodeMajor = [int](& node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 20) {
  throw "Node.js 20 or newer is required (found major version $nodeMajor)."
}

$pnpmCommand = Get-Command 'corepack.cmd' -ErrorAction SilentlyContinue
if (-not $pnpmCommand) { $pnpmCommand = Get-Command 'pnpm.cmd' -ErrorAction SilentlyContinue }
if (-not $pnpmCommand) { throw 'pnpm or corepack was not found on PATH.' }

Set-DefaultEnv 'MYSQL_ROOT_PASSWORD' 'local_root_password'
Set-DefaultEnv 'MYSQL_DATABASE' 'cattle_management'
Set-DefaultEnv 'MYSQL_USER' 'cattle_user'
Set-DefaultEnv 'MYSQL_PASSWORD' 'local_database_password'
Set-DefaultEnv 'MYSQL_HOST' '127.0.0.1'
Set-DefaultEnv 'MYSQL_HOST_PORT' '9193'
Set-DefaultEnv 'MYSQL_PORT' '9193'
Set-DefaultEnv 'MYSQL_API_PORT' '9192'
Set-DefaultEnv 'MQTT_ENABLED' 'true'
Set-DefaultEnv 'MQTT_HOST' '0.0.0.0'
Set-DefaultEnv 'MQTT_PORT' '9194'
Set-DefaultEnv 'MQTT_TOPIC' 'cattle/+/temperature'
Set-DefaultEnv 'MQTT_USERNAME' 'local_mqtt'
Set-DefaultEnv 'MQTT_PASSWORD' 'local_mqtt_password'
Set-DefaultEnv 'TH_SHRC_ENABLED' 'true'
Set-DefaultEnv 'AUTH_MODE' 'strict'
Set-DefaultEnv 'ADMIN_USER' 'admin'
Set-DefaultEnv 'ADMIN_PASSWORD' 'local_admin_password'
Set-DefaultEnv 'DEFAULT_PERSON_PASSWORD' 'local_person_password'
Set-DefaultEnv 'VITE_PORT' '9191'
Set-DefaultEnv 'VITE_API_URL' '/'
Set-DefaultEnv 'VITE_CACHE_DIR' (Join-Path $env:TEMP 'ear-tag-th-shrc-vite-cache')

$env:MYSQL_HOST_PORT = [string](Select-LocalPort ([int]$env:MYSQL_HOST_PORT) 9293)
$env:MYSQL_PORT = $env:MYSQL_HOST_PORT
$env:MYSQL_API_PORT = [string](Select-LocalPort ([int]$env:MYSQL_API_PORT) 9292 @($env:MYSQL_HOST_PORT))
$env:MQTT_PORT = [string](Select-LocalPort ([int]$env:MQTT_PORT) 9294 @($env:MYSQL_HOST_PORT, $env:MYSQL_API_PORT))
$env:VITE_PORT = [string](Select-LocalPort ([int]$env:VITE_PORT) 9291 @($env:MYSQL_HOST_PORT, $env:MYSQL_API_PORT, $env:MQTT_PORT))
Set-DefaultEnv 'MYSQL_CONTAINER_NAME' "cattle-mysql-local-$($env:MYSQL_HOST_PORT)"
$env:MYSQL_VOLUME_NAME = "ear_tag_th_shrc_mysql_$($env:MYSQL_HOST_PORT)"
$env:VITE_API_PROXY_URL = "http://127.0.0.1:$($env:MYSQL_API_PORT)"
$env:LOCAL_BACKEND_URL = "http://127.0.0.1:$($env:MYSQL_API_PORT)"

if (-not $SkipInstall) {
  if ($pnpmCommand.Name -eq 'pnpm.cmd') {
    & $pnpmCommand.Source install --frozen-lockfile
  } else {
    & $pnpmCommand.Source pnpm install --frozen-lockfile
  }
  if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
}

Ensure-DockerDesktop
$composeFile = Join-Path $Root 'database/mysql/docker-compose.local.yml'
docker compose -f $composeFile up -d
if ($LASTEXITCODE -ne 0) { throw 'MySQL container failed to start.' }

$health = ''
$deadline = (Get-Date).AddSeconds(120)
do {
  $health = docker inspect $env:MYSQL_CONTAINER_NAME --format '{{.State.Health.Status}}' 2>$null
  if ($health -eq 'healthy') { break }
  Start-Sleep -Seconds 2
} while ((Get-Date) -lt $deadline)
if ($health -ne 'healthy') { throw 'MySQL container did not become healthy in time.' }

$apiHealthUrl = "$($env:LOCAL_BACKEND_URL)/api/health"
try {
  Invoke-WebRequest -UseBasicParsing -Uri $apiHealthUrl -TimeoutSec 2 | Out-Null
} catch {
  Start-Process -FilePath 'node' `
    -ArgumentList @('scripts/mysql-backend-server.mjs') `
    -WorkingDirectory $Root `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $LogDir 'backend.log') `
    -RedirectStandardError (Join-Path $LogDir 'backend.err.log')
}

Wait-Http -Url $apiHealthUrl -TimeoutSeconds 90

$frontendUrl = "http://127.0.0.1:$($env:VITE_PORT)"
try {
  Invoke-WebRequest -UseBasicParsing -Uri $frontendUrl -TimeoutSec 2 | Out-Null
} catch {
  if ($pnpmCommand.Name -eq 'pnpm.cmd') {
    Start-Process -FilePath $pnpmCommand.Source `
      -ArgumentList @('exec', 'vite', '--host', '127.0.0.1', '--port', $env:VITE_PORT) `
      -WorkingDirectory $Root `
      -WindowStyle Hidden `
      -RedirectStandardOutput (Join-Path $LogDir 'frontend.log') `
      -RedirectStandardError (Join-Path $LogDir 'frontend.err.log')
  } else {
    Start-Process -FilePath $pnpmCommand.Source `
      -ArgumentList @('pnpm', 'exec', 'vite', '--host', '127.0.0.1', '--port', $env:VITE_PORT) `
      -WorkingDirectory $Root `
      -WindowStyle Hidden `
      -RedirectStandardOutput (Join-Path $LogDir 'frontend.log') `
      -RedirectStandardError (Join-Path $LogDir 'frontend.err.log')
  }
}

Wait-Http -Url $frontendUrl -TimeoutSeconds 90
& node scripts/check-th-shrc-live.mjs
if ($LASTEXITCODE -ne 0) { throw 'TH-SHRC live integration check failed.' }

Write-Host ''
Write-Host 'Local platform is ready:'
Write-Host "  Frontend: $frontendUrl/"
Write-Host "  Backend:  $apiHealthUrl"
Write-Host "  MQTT:     mqtt://127.0.0.1:$($env:MQTT_PORT) (cattle/+/temperature)"
Write-Host '  TH-SHRC:  enabled and verified through a live MQTT message'
Write-Host "  Login:    $($env:ADMIN_USER) / $($env:ADMIN_PASSWORD)"
