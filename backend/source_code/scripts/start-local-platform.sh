#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="$ROOT/logs"
mkdir -p "$LOG_DIR"

if [[ "${1:-}" == "--skip-install" || "${SKIP_INSTALL:-0}" == "1" ]]; then
  SKIP_INSTALL=1
else
  SKIP_INSTALL=0
fi

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Required command '$1' was not found on PATH." >&2
    exit 1
  }
}

wait_http() {
  local url="$1"
  local timeout="${2:-90}"
  local deadline=$((SECONDS + timeout))
  while (( SECONDS < deadline )); do
    if curl --fail --silent --show-error --max-time 3 "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  echo "Timed out waiting for $url" >&2
  exit 1
}

port_free() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ! ss -ltnH | awk -v p=":${port}" '$4 == p || $4 ~ p"$" { found = 1 } END { exit found ? 0 : 1 }'
  elif command -v nc >/dev/null 2>&1; then
    ! nc -z 127.0.0.1 "$port" >/dev/null 2>&1
  else
    return 0
  fi
}

select_port() {
  local requested="$1"
  local fallback="$2"
  shift 2
  local reserved=("$@")
  local is_reserved=0
  for item in "${reserved[@]}"; do
    [[ "$item" == "$requested" ]] && is_reserved=1
  done
  if (( is_reserved == 0 )) && port_free "$requested"; then
    echo "$requested"
    return
  fi
  local candidate="$fallback"
  while :; do
    is_reserved=0
    for item in "${reserved[@]}"; do
      [[ "$item" == "$candidate" ]] && is_reserved=1
    done
    (( is_reserved == 0 )) && port_free "$candidate" && break
    candidate=$((candidate + 1))
  done
  echo "$candidate"
}

require_command node
require_command curl
require_command docker

node -e "if (Number(process.versions.node.split('.')[0]) < 20) process.exit(1)" || {
  echo 'Node.js 20 or newer is required.' >&2
  exit 1
}

if command -v corepack >/dev/null 2>&1; then
  PNPM=(corepack pnpm)
elif command -v pnpm >/dev/null 2>&1; then
  PNPM=(pnpm)
else
  echo 'pnpm or corepack was not found on PATH.' >&2
  exit 1
fi

export MYSQL_ROOT_PASSWORD="${MYSQL_ROOT_PASSWORD:-local_root_password}"
export MYSQL_DATABASE="${MYSQL_DATABASE:-cattle_management}"
export MYSQL_USER="${MYSQL_USER:-cattle_user}"
export MYSQL_PASSWORD="${MYSQL_PASSWORD:-local_database_password}"
export MYSQL_HOST="${MYSQL_HOST:-127.0.0.1}"
export MYSQL_HOST_PORT="${MYSQL_HOST_PORT:-9193}"
export MYSQL_PORT="${MYSQL_PORT:-$MYSQL_HOST_PORT}"
export MYSQL_API_PORT="${MYSQL_API_PORT:-9192}"
export MQTT_ENABLED="${MQTT_ENABLED:-true}"
export MQTT_HOST="${MQTT_HOST:-0.0.0.0}"
export MQTT_PORT="${MQTT_PORT:-9194}"
export MQTT_TOPIC="${MQTT_TOPIC:-cattle/+/temperature}"
export MQTT_USERNAME="${MQTT_USERNAME:-local_mqtt}"
export MQTT_PASSWORD="${MQTT_PASSWORD:-local_mqtt_password}"
export TH_SHRC_ENABLED="${TH_SHRC_ENABLED:-true}"
export AUTH_MODE="${AUTH_MODE:-strict}"
export ADMIN_USER="${ADMIN_USER:-admin}"
export ADMIN_PASSWORD="${ADMIN_PASSWORD:-local_admin_password}"
export DEFAULT_PERSON_PASSWORD="${DEFAULT_PERSON_PASSWORD:-local_person_password}"
export VITE_PORT="${VITE_PORT:-9191}"
export VITE_API_URL="${VITE_API_URL:-/}"
export VITE_CACHE_DIR="${VITE_CACHE_DIR:-${TMPDIR:-/tmp}/ear-tag-th-shrc-vite-cache}"
export MYSQL_HOST_PORT="$(select_port "$MYSQL_HOST_PORT" 9293)"
export MYSQL_PORT="$MYSQL_HOST_PORT"
export MYSQL_API_PORT="$(select_port "$MYSQL_API_PORT" 9292 "$MYSQL_HOST_PORT")"
export MQTT_PORT="$(select_port "$MQTT_PORT" 9294 "$MYSQL_HOST_PORT" "$MYSQL_API_PORT")"
export VITE_PORT="$(select_port "$VITE_PORT" 9291 "$MYSQL_HOST_PORT" "$MYSQL_API_PORT" "$MQTT_PORT")"
export MYSQL_CONTAINER_NAME="${MYSQL_CONTAINER_NAME:-cattle-mysql-local-${MYSQL_HOST_PORT}}"
export MYSQL_VOLUME_NAME="ear_tag_th_shrc_mysql_${MYSQL_HOST_PORT}"
export VITE_API_PROXY_URL="http://127.0.0.1:${MYSQL_API_PORT}"
export LOCAL_BACKEND_URL="http://127.0.0.1:${MYSQL_API_PORT}"

cd "$ROOT"
if (( SKIP_INSTALL == 0 )); then
  "${PNPM[@]}" install --frozen-lockfile
fi

if ! docker version >/dev/null 2>&1; then
  echo 'Docker engine is not ready. Start Docker and run this script again.' >&2
  exit 1
fi

docker compose -f "$ROOT/database/mysql/docker-compose.local.yml" up -d

deadline=$((SECONDS + 120))
health=''
while (( SECONDS < deadline )); do
  health="$(docker inspect "$MYSQL_CONTAINER_NAME" --format '{{.State.Health.Status}}' 2>/dev/null || true)"
  [[ "$health" == 'healthy' ]] && break
  sleep 2
done
if [[ "$health" != 'healthy' ]]; then
  echo 'MySQL container did not become healthy in time.' >&2
  exit 1
fi

if ! curl --fail --silent --show-error --max-time 2 "$LOCAL_BACKEND_URL/api/health" >/dev/null 2>&1; then
  nohup node scripts/mysql-backend-server.mjs \
    >"$LOG_DIR/backend.log" 2>"$LOG_DIR/backend.err.log" &
  echo $! >"$LOG_DIR/backend.pid"
fi

wait_http "$LOCAL_BACKEND_URL/api/health" 90

if ! curl --fail --silent --show-error --max-time 2 "http://127.0.0.1:${VITE_PORT}/" >/dev/null 2>&1; then
  nohup env VITE_PORT="$VITE_PORT" VITE_API_URL="$VITE_API_URL" \
    VITE_API_PROXY_URL="$VITE_API_PROXY_URL" \
    "${PNPM[@]}" exec vite --host 127.0.0.1 --port "$VITE_PORT" \
    >"$LOG_DIR/frontend.log" 2>"$LOG_DIR/frontend.err.log" &
  echo $! >"$LOG_DIR/frontend.pid"
fi

wait_http "http://127.0.0.1:${VITE_PORT}/" 90
node scripts/check-th-shrc-live.mjs

echo
echo 'Local platform is ready:'
echo "  Frontend: http://127.0.0.1:${VITE_PORT}/"
echo "  Backend:  ${LOCAL_BACKEND_URL}/api/health"
echo "  MQTT:     mqtt://127.0.0.1:${MQTT_PORT} (cattle/+/temperature)"
echo '  TH-SHRC:  enabled and verified through a live MQTT message'
echo "  Login:    ${ADMIN_USER} / ${ADMIN_PASSWORD}"
