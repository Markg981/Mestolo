#!/usr/bin/env bash
# Runs the migrations and the RLS test suite against a throw-away local
# PostgreSQL (>= 15) instance, using a stub of the Supabase auth/storage schemas.
# Requires: initdb, pg_ctl, psql on PATH (or PG_BIN set).
set -euo pipefail

PG_BIN="${PG_BIN:-$(dirname "$(command -v initdb 2>/dev/null || ls /usr/lib/postgresql/*/bin/initdb | tail -1)")}"
PORT="${PG_TEST_PORT:-54329}"
DIR="$(mktemp -d)"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cleanup() { "$PG_BIN/pg_ctl" -D "$DIR" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DIR"; }
trap cleanup EXIT

if [ "$(id -u)" = "0" ]; then
  echo "Run as a non-root user (PostgreSQL refuses to run as root)." >&2
  exit 1
fi

"$PG_BIN/initdb" -D "$DIR" -U postgres -A trust >/dev/null
"$PG_BIN/pg_ctl" -D "$DIR" -o "-p $PORT -k $DIR -c listen_addresses=''" -l "$DIR/log" start >/dev/null

PSQL=("$PG_BIN/psql" -h "$DIR" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -c "create database mestolo_test" >/dev/null
"${PSQL[@]}" -d mestolo_test -f "$ROOT/supabase/tests/supabase-stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "Applying $(basename "$f")"
  "${PSQL[@]}" -d mestolo_test -f "$f" >/dev/null
done

export TEST_DATABASE_URL="postgresql://postgres@localhost:$PORT/mestolo_test?host=$DIR"
cd "$ROOT"
npx vitest run --config vitest.db.config.ts
