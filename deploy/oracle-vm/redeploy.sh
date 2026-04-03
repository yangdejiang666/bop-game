#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

cd "${ROOT_DIR}"

if [[ -d .git ]]; then
  git pull --ff-only
fi

cd "${SCRIPT_DIR}"

if [[ ! -f .env ]]; then
  echo "缺少 deploy/oracle-vm/.env，请先从 .env.example 复制一份再填写。"
  exit 1
fi

wait_for_postgres() {
  echo "等待 Postgres 就绪..."
  until docker compose exec -T postgres pg_isready -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" >/dev/null 2>&1; do
    sleep 2
  done
}

apply_sql_file() {
  local sql_file="$1"
  if [[ ! -f "${sql_file}" ]]; then
    echo "跳过缺失脚本: ${sql_file}"
    return 0
  fi

  echo "应用数据库脚本: $(basename "${sql_file}")"
  docker compose exec -T postgres \
    psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" < "${sql_file}"
}

docker compose build --pull
docker compose up -d postgres
wait_for_postgres
apply_sql_file ../../database/003_enterprise_app_foundation.sql
apply_sql_file ../../database/004_auth_communications.sql
apply_sql_file ../../database/005_lobby_modes.sql
docker compose up -d --remove-orphans

echo "部署完成。"
echo "API 健康检查: https://${API_DOMAIN:-api.example.com}/healthz"
echo "WebSocket 入口: ${PUBLIC_GAME_WS_URL:-wss://ws.example.com/ws}"
