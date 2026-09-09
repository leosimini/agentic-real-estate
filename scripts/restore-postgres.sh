#!/usr/bin/env sh
set -eu

if [ -z "${DATABASE_URL:-}" ] || [ -z "${BACKUP_FILE:-}" ]; then
  echo "DATABASE_URL and BACKUP_FILE are required" >&2
  exit 1
fi
if [ "${CONFIRM_RESTORE:-}" != "restore" ]; then
  echo "Set CONFIRM_RESTORE=restore to acknowledge the destructive restore" >&2
  exit 1
fi
if [ ! -f "$BACKUP_FILE" ] || [ ! -f "${BACKUP_FILE}.sha256" ]; then
  echo "Backup and matching .sha256 file are required" >&2
  exit 1
fi

shasum -a 256 -c "${BACKUP_FILE}.sha256"
pg_restore --dbname="$DATABASE_URL" --clean --if-exists --no-owner --no-privileges --single-transaction "$BACKUP_FILE"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "SELECT version, applied_at FROM schema_migration ORDER BY version;"

echo "Restore completed and migration ledger verified"
