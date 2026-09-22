#!/usr/bin/env bash
# backup.sh — dumps the Postgres database from the running "db" compose
# service, gzips it, and prunes backups older than the retention window.
#
# Usage:
#   scripts/backup.sh [output_dir] [retention_days]
#
#   output_dir       Directory to write the backup into (default: ./backups)
#   retention_days   Delete backups older than this many days (default: 14;
#                     use 0 to disable pruning)
#
# Reads POSTGRES_USER / POSTGRES_DB from .env if present (falls back to the
# same defaults as docker-compose.yml). Does not read or print POSTGRES_PASSWORD
# — the dump runs inside the container via `docker compose exec`, which does
# not need it.
#
# Requires: the "db" compose service must already be running. This script
# never starts, stops, or restarts it.

set -euo pipefail

usage() {
  cat <<EOF
Usage: $0 [output_dir] [retention_days]

  output_dir       Directory to write the backup into (default: ./backups)
  retention_days   Delete backups older than this many days (default: 14;
                    use 0 to disable pruning)
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

OUTPUT_DIR="${1:-./backups}"
RETENTION_DAYS="${2:-14}"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

POSTGRES_USER="${POSTGRES_USER:-hisse}"
POSTGRES_DB="${POSTGRES_DB:-hisse_analizi}"

if ! [[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]]; then
  echo "retention_days must be a non-negative integer, got: ${RETENTION_DAYS}" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_FILE="${OUTPUT_DIR}/${POSTGRES_DB}-${TIMESTAMP}.sql.gz"
TMP_FILE="${BACKUP_FILE}.part"

# If pg_dump or gzip fails partway through, `> "$TMP_FILE"` has already created
# it — clean up the partial/empty file instead of leaving a broken backup that
# looks legitimate (matches the *.sql.gz naming) sitting next to real ones.
trap 'rm -f "$TMP_FILE"' EXIT

echo "Backing up database '${POSTGRES_DB}' (user '${POSTGRES_USER}') to ${BACKUP_FILE} ..."

docker compose exec -T db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges \
  | gzip > "$TMP_FILE"

mv "$TMP_FILE" "$BACKUP_FILE"
trap - EXIT

echo "Backup written: ${BACKUP_FILE} ($(du -h "$BACKUP_FILE" | cut -f1))"

if [[ "$RETENTION_DAYS" -gt 0 ]]; then
  echo "Pruning backups older than ${RETENTION_DAYS} day(s) in ${OUTPUT_DIR} ..."
  find "$OUTPUT_DIR" -maxdepth 1 -type f -name "${POSTGRES_DB}-*.sql.gz" -mtime "+${RETENTION_DAYS}" -print -delete
fi

echo "Done."
