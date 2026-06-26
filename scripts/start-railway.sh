#!/bin/sh
set -eu

: "${PORT:=8080}"
: "${INKY_DATA_DIR:=/data}"
: "${INKY_DATABASE_URL:=sqlite:////data/inky.db}"
export PORT INKY_DATA_DIR INKY_DATABASE_URL

mkdir -p "$INKY_DATA_DIR" /run/nginx

envsubst '${PORT}' < /etc/nginx/templates/railway.conf.template > /etc/nginx/conf.d/default.conf
rm -f /etc/nginx/sites-enabled/default

cd /app/backend
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --no-access-log &
api_pid="$!"

cleanup() {
  kill "$api_pid" 2>/dev/null || true
}
trap cleanup INT TERM EXIT

nginx -g "daemon off;"
