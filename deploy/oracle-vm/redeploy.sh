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

docker compose build --pull
docker compose up -d --remove-orphans

echo "部署完成。"
echo "API 健康检查: https://${API_DOMAIN:-api.example.com}/healthz"
echo "WebSocket 入口: ${PUBLIC_GAME_WS_URL:-wss://ws.example.com/ws}"

