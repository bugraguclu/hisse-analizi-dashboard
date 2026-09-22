#!/usr/bin/env bash
# restore.sh — restores a gzip'd pg_dump backup (as produced by backup.sh)
# into the Postgres database of the running "db" compose service.
#
# Usage:
#   scripts/restore.sh [-y|--yes] <backup_file.sql.gz>
#
#   -y, --yes   Skip the confirmation prompt (for non-interactive use).
#
# WARNING: this overwrites objects in the target database. Prefer restoring
# into a throwaway/staging database unless you are certain.
#
# Reads POSTGRES_USER / POSTGRES_DB from .env if present (falls back to the
# same defaults as docker-compose.yml). Does not read or print POSTGRES_PASSWORD
# — the restore runs inside the container via `docker compose exec`, which does
# not need it.
#
# Requires: the "db" compose service must already be running. This script
# never starts, stops, or restarts it.

set -euo pipefail

usage() {
  cat <<EOF
Usage: $0 [-y|--yes] <backup_file.sql.gz>

  -y, --yes   Skip the confirmation prompt (for non-interactive use).

WARNING: this overwrites objects in the target database. Prefer restoring
into a throwaway/staging database unless you are certain.
EOF
}

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ASSUME_YES=0
BACKUP_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -y|--yes)
      ASSUME_YES=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      BACKUP_FILE="$1"
      shift
      ;;
  esac
done

if [[ -z "$BACKUP_FILE" ]]; then
  usage >&2
  exit 1
fi

if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "Backup file not found: ${BACKUP_FILE}" >&2
  exit 1
fi

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

POSTGRES_USER="${POSTGRES_USER:-hisse}"
POSTGRES_DB="${POSTGRES_DB:-hisse_analizi}"

if [[ "$ASSUME_YES" -ne 1 ]]; then
  read -r -p "This will overwrite database '${POSTGRES_DB}'. Continue? [y/N] " CONFIRM
  case "$CONFIRM" in
    y|Y|yes|YES) ;;
    *) echo "Aborted."; exit 1 ;;
  esac
fi

echo "Restoring ${BACKUP_FILE} into database '${POSTGRES_DB}' (user '${POSTGRES_USER}') ..."

gunzip -c "$BACKUP_FILE" | docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" --set ON_ERROR_STOP=1

echo "Restore complete."
