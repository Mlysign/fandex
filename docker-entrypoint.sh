#!/bin/sh
set -e

# Litestream backups (P5) are opt-in, keyed on the Railway bucket's AWS_S3_BUCKET_NAME.
# When set: restore the DB from the replica ONLY if there's no local DB yet (fresh
# volume) — otherwise the existing volume DB is authoritative — then run the app
# under continuous replication. When unset: run the app directly (no backups).
if [ -n "${AWS_S3_BUCKET_NAME}" ]; then
  if [ ! -f "${DB_PATH}" ]; then
    echo "[entrypoint] No local DB at ${DB_PATH} — restoring from backup if one exists."
    litestream restore -if-replica-exists "${DB_PATH}" || true
  else
    echo "[entrypoint] Local DB present; skipping restore (volume is authoritative)."
  fi
  echo "[entrypoint] Starting app under Litestream replication (bucket=${AWS_S3_BUCKET_NAME})."
  exec litestream replicate -exec "node server.js"
fi

echo "[entrypoint] AWS_S3_BUCKET_NAME not set; running without backups."
exec node server.js
