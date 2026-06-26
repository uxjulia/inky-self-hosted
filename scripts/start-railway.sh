#!/bin/sh
set -eu

: "${PORT:=8080}"
: "${INKY_DATA_DIR:=/data}"
: "${INKY_DATABASE_URL:=sqlite:////data/inky.db}"
: "${INKY_STATIC_DIR:=/app/frontend/dist}"
: "${INKY_PUBLIC_READ_ONLY:=1}"
: "${INKY_APP_ROOT:=/app}"
: "${PYTHON_BIN:=python}"
export PORT INKY_DATA_DIR INKY_DATABASE_URL INKY_STATIC_DIR INKY_PUBLIC_READ_ONLY INKY_APP_ROOT PYTHON_BIN

mkdir -p "$INKY_DATA_DIR"

cd "$INKY_APP_ROOT/backend"
exec "$PYTHON_BIN" -m uvicorn app.main:app --host 0.0.0.0 --port "$PORT" --no-access-log
