#!/bin/sh
set -e

# ── One-shot VACUUM (2026-08-19), OFF unless VACUUM_ON_BOOT=1 ────────────────
# Deleting rows does not shrink a SQLite file; the pages go on the freelist and
# get reused. `facet_page_cache` grew to 222.8 MB of a 331 MB database before it
# was bounded, so once the app has trimmed it the file still reads 331 MB with
# ~270 MB of holes — and it is the FILE SIZE the kernel page-caches, which is
# what Railway's memory graph bills. VACUUM is the only way to hand it back.
#
# It runs HERE, before `litestream replicate`, on purpose: VACUUM takes an
# exclusive lock, and with Litestream already attached as a second connection it
# fails busy. That is the same wall `wal_checkpoint(TRUNCATE)` hit twice from a
# Railway shell. Closing the connection afterwards also truncates the WAL, which
# is the only thing that clears its 340 MB high-water mark.
#
# ⚠️ CHECK THE LITESTREAM GENERATION AFTER, and do not assume which way it goes.
# A VACUUM performed *while* Litestream was attached (2026-07-21) was absorbed
# into the existing generation `18d8221abccc198d`, and PR17 recorded an
# UNCHANGED generation as the healthy signal. This VACUUM runs before Litestream
# attaches, so it may instead find the file changed under its last shadow-WAL
# position and start a new generation with a full snapshot. Both outcomes are
# acceptable here; a new one is only alarming when nothing deliberate caused it.
# Confirm replication is live afterwards before treating the old generation as
# disposable.
#
# One-shot by design: flip the Railway variable to 1, redeploy, read the log
# line, then remove the variable. Never leave it on — a VACUUM every boot means
# a full backup re-upload every boot.
if [ "${VACUUM_ON_BOOT}" = "1" ] && [ -f "${DB_PATH}" ]; then
  echo "[entrypoint] VACUUM_ON_BOOT=1 — reclaiming free pages before Litestream attaches."
  # SQLite's VACUUM builds the new database in a temp file. Point that at the
  # volume, not the container's ephemeral /tmp, which has neither the space nor
  # any reason to hold a copy of the DB.
  SQLITE_TMPDIR="$(dirname "${DB_PATH}")" node -e '
    const Database = require("better-sqlite3");
    const db = new Database(process.env.DB_PATH);
    const mb = () =>
      Math.round(
        (db.pragma("page_count", { simple: true }) * db.pragma("page_size", { simple: true })) / 1048576
      );
    const before = mb();
    const freeBefore = db.pragma("freelist_count", { simple: true });
    db.pragma("wal_checkpoint(TRUNCATE)");
    db.exec("VACUUM");
    console.log("[vacuum] " + before + " MB (" + freeBefore + " free pages) -> " + mb() + " MB");
    db.close(); // last connection closing is what truncates the WAL file
  ' || echo "[entrypoint] VACUUM failed — continuing with the existing file (not fatal)."
fi

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
