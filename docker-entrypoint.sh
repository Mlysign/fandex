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
  # Which config. litestream.yml replicates to the Railway bucket alone, exactly
  # as before. litestream-r2.yml adds a second replica on Cloudflare R2, and is
  # used only when ALL FOUR R2 values are present (2026-10-04, docs/app-plan.md
  # step 0: the Railway bucket dies with the Railway plan).
  #
  # The R2 config is checked before it is trusted. `litestream databases` parses
  # the file and exits non-zero on a config it cannot use, so a typo in an R2
  # value falls back to the Railway-only config and the site still boots. A
  # backup setting must never be able to take the app down. Wrong CREDENTIALS
  # are not caught here; they show up in the logs as sync errors on the r2
  # replica while the app and the Railway replica carry on.
  LS_CONFIG=/etc/litestream.yml
  if [ -n "${R2_ACCESS_KEY_ID}" ] && [ -n "${R2_SECRET_ACCESS_KEY}" ] && [ -n "${R2_BUCKET}" ] && [ -n "${R2_ENDPOINT}" ]; then
    if litestream databases -config /etc/litestream-r2.yml >/dev/null 2>&1; then
      LS_CONFIG=/etc/litestream-r2.yml
      echo "[entrypoint] R2 replica configured (bucket=${R2_BUCKET}); replicating to the Railway bucket AND R2."
    else
      echo "[entrypoint] R2 values are set but /etc/litestream-r2.yml does not parse; using the Railway bucket only."
    fi
  fi

  if [ ! -f "${DB_PATH}" ]; then
    echo "[entrypoint] No local DB at ${DB_PATH} — restoring from backup if one exists."
    litestream restore -config "${LS_CONFIG}" -if-replica-exists "${DB_PATH}" || true
  else
    echo "[entrypoint] Local DB present; skipping restore (volume is authoritative)."
  fi
  echo "[entrypoint] Starting app under Litestream replication (bucket=${AWS_S3_BUCKET_NAME})."
  exec litestream replicate -config "${LS_CONFIG}" -exec "node server.js"
fi

echo "[entrypoint] AWS_S3_BUCKET_NAME not set; running without backups."
exec node server.js
