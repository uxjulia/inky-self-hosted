#!/bin/sh
set -eu

: "${PORT:=8080}"
: "${INKY_DATA_DIR:=/data}"
: "${INKY_DATABASE_URL:=sqlite:////data/inky.db}"
: "${INKY_STATIC_DIR:=/app/frontend/dist}"
: "${INKY_PUBLIC_READ_ONLY:=1}"
export PORT INKY_DATA_DIR INKY_DATABASE_URL INKY_STATIC_DIR INKY_PUBLIC_READ_ONLY

mkdir -p "$INKY_DATA_DIR"

cd /app/backend
exec python -m uvicorn app.main:app --host 0.0.0.0 --port "$PORT" --no-access-log
