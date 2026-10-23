#!/usr/bin/env bash
# One-time data migration for the Phase 6 API cutover: dumps the VPS's
# dockerized Postgres (the database `apps/api` has used since launch) and
# restores it into Neon (the database `apps/api-worker` connects to via
# Hyperdrive). Run this ONCE, during the cutover maintenance window, after
# writes to the VPS database have been frozen (stop the `api` container or
# put it in read-only/maintenance mode first — this script does not do that
# for you, see deploy/CUTOVER.md).
#
# Usage (on the VPS, from /opt/suluhu):
#   NEON_DIRECT_URL='postgresql://user:pass@ep-...neon.tech/suluhu?sslmode=require' \
#     ./deploy/migrate-db-to-neon.sh
#
# Safe to re-run: it drops and recreates every object in the target database
# before restoring, so a failed/partial run can simply be re-run once the
# cause is fixed. It does NOT touch the source (VPS) database.
set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/suluhu}"
COMPOSE=(docker compose -f "$REPO_DIR/docker-compose.prod.yml" --env-file "$REPO_DIR/.env.production")

if [[ -z "${NEON_DIRECT_URL:-}" ]]; then
  echo "NEON_DIRECT_URL is required (Neon's *direct*, non-pooled connection string)." >&2
  exit 1
fi

# shellcheck disable=SC1091
set -a; source "$REPO_DIR/.env.production"; set +a

dump_file="$(mktemp -t suluhu-neon-migration-XXXXXX.sql)"
trap 'rm -f "$dump_file"' EXIT

echo "Dumping $POSTGRES_DB from the VPS postgres container..."
"${COMPOSE[@]}" exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges --clean --if-exists \
  > "$dump_file"

if [[ "$(stat -c %s "$dump_file")" -lt 1024 ]]; then
  echo "Dump looks truncated ($dump_file) — aborting without touching Neon." >&2
  exit 1
fi

echo "Restoring into Neon..."
psql "$NEON_DIRECT_URL" --set ON_ERROR_STOP=on -f "$dump_file"

echo "Verifying row counts (VPS vs Neon)..."
vps_counts="$("${COMPOSE[@]}" exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c \
  "select relname, n_live_tup from pg_stat_user_tables order by relname;")"
neon_counts="$(psql "$NEON_DIRECT_URL" -At -c \
  "select relname, n_live_tup from pg_stat_user_tables order by relname;")"

if [[ "$vps_counts" != "$neon_counts" ]]; then
  echo "WARNING: per-table row counts differ between VPS and Neon — inspect before cutting over:" >&2
  diff <(echo "$vps_counts") <(echo "$neon_counts") || true
  echo "(pg_stat_user_tables counts are estimates refreshed by autovacuum, so a" >&2
  echo "small drift right after a bulk restore can be stale stats, not data loss —" >&2
  echo "re-run 'analyze;' on both sides and recheck before treating this as real.)" >&2
else
  echo "Row counts match. Migration looks complete."
fi

echo "Done. Dump was written to a temp file and has been removed; the VPS database is untouched."
