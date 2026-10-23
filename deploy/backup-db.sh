#!/usr/bin/env bash
# RETIRED — kept for reference only (legacy VPS stack, never went live).
# Production Postgres is Neon, which has its own backups/point-in-time restore.
#
# Nightly Postgres dump for the single-host stack. Dumps are gzipped, kept for
# RETENTION_DAYS, and should be copied off the server (object storage) — a dump
# sitting on the same disk as the database is not a backup.
#
# Install on the host:
#   sudo ln -s /opt/suluhu/deploy/backup-db.sh /etc/cron.daily/suluhu-backup
set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/suluhu}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/suluhu}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
COMPOSE=(docker compose -f "$REPO_DIR/docker-compose.prod.yml" --env-file "$REPO_DIR/.env.production")

# shellcheck disable=SC1091
set -a; source "$REPO_DIR/.env.production"; set +a

mkdir -p "$BACKUP_DIR"
target="$BACKUP_DIR/suluhu-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"

"${COMPOSE[@]}" exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --clean --if-exists \
  | gzip -9 > "$target"

# A dump that is suspiciously small means pg_dump failed mid-stream.
if [[ "$(stat -c %s "$target")" -lt 1024 ]]; then
  echo "backup looks truncated: $target" >&2
  exit 1
fi

find "$BACKUP_DIR" -name 'suluhu-*.sql.gz' -mtime "+$RETENTION_DAYS" -delete
echo "wrote $target"
