#!/usr/bin/env sh
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is required" >&2
  exit 1
fi

backup_dir="${BACKUP_DIR:-./backups}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_file="${backup_dir}/realty-${timestamp}.dump"

umask 077
mkdir -p "$backup_dir"
pg_dump "$DATABASE_URL" --format=custom --no-owner --no-privileges --file="$backup_file"
shasum -a 256 "$backup_file" > "${backup_file}.sha256"

echo "Backup created: $backup_file"
echo "Checksum created: ${backup_file}.sha256"
