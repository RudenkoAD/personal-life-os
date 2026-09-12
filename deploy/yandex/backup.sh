#!/bin/bash
set -euo pipefail
umask 077
root=/srv/personal-life-os
stamp=$(date -u +%Y%m%dT%H%M%SZ)
mkdir "$root/backups/$stamp"
trap 'rm -rf "$root/backups/$stamp.partial"' EXIT
sqlite3 "$root/data/life-os.sqlite" ".timeout 10000" ".backup '$root/backups/$stamp.partial'"
test "$(sqlite3 "$root/backups/$stamp.partial" 'PRAGMA integrity_check;')" = ok
mv "$root/backups/$stamp.partial" "$root/backups/$stamp/life-os.sqlite"
cp "$root/secrets/runtime.env" "$root/backups/$stamp/runtime.env"
# Snapshot schedules retain complete disk copies separately.
find "$root/backups" -mindepth 1 -maxdepth 1 -type d -mtime +7 -exec rm -rf -- {} +
