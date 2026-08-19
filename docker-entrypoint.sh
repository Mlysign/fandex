#!/bin/sh
set -e

# NOTE: there is deliberately NO vacuum step here. Two mechanisms already cover
# it and both are better placed. (1) src/lib/db.ts VACUUMs automatically after
# any migration actually applies — that is what took the file 331.4 MB -> 154.2 MB
# on 2026-08-19 when migration 18 ran, with Litestream attached and no trouble.
# (2) POST /api/dev/prune {"action":"vacuum","confirm":"VACUUM"} is the manual
# lever, and unlike an entrypoint flag it checks volumeInfo().hasRoomToVacuum
# first. A VACUUM_ON_BOOT env flag was added here and removed the same day: it
# was a third, worse copy, and it rested on the premise that VACUUM needs the
# exclusive lock before Litestream attaches, which the 331->154 drop disproves.

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
