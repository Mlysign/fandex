// Rehearse migration 16 (user_library / user_watchlist -> views) against a copy
// of a REAL database, through the STANDALONE apply path.
//
// Why this exists, in the words of AGENTS.md: migrations have two apply paths,
// and green tests only prove the in-process one. Every DB test in the suite also
// starts from a fresh database, so none of them takes the upgrade path
// production actually takes. This does both — it runs scripts/migrate.mjs (plain
// node, no @/* alias, no extensionless specifiers) against a prod-shaped file
// and then proves, row by row, that the views return exactly what the tables
// held beforehand.
//
//   node scripts/rehearse-cache-view-migration.mjs data/rr.db
//
// Exits non-zero on any mismatch. Never touches the source database: it works on
// two VACUUM INTO snapshots and deletes them unless --keep is passed.
import Database from "better-sqlite3";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const src = process.argv[2];
const keep = process.argv.includes("--keep");
if (!src) {
  console.error("usage: node scripts/rehearse-cache-view-migration.mjs <db> [--keep]");
  process.exit(1);
}

const dir = keep ? "." : os.tmpdir();
const beforePath = path.join(dir, `rr-rehearse-before-${process.pid}.db`);
const workPath = path.join(dir, `rr-rehearse-work-${process.pid}.db`);
const cleanup = () => {
  if (keep) return;
  for (const p of [beforePath, workPath, `${workPath}-wal`, `${workPath}-shm`]) fs.rmSync(p, { force: true });
};

const problems = [];
const check = (ok, label, detail = "") => {
  console.log(`   ${ok ? "OK  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) problems.push(label);
};

try {
  // ── 1. Two identical snapshots of the real thing ───────────────────────────
  for (const p of [beforePath, workPath]) fs.rmSync(p, { force: true });
  const source = new Database(src, { readonly: true });
  source.exec(`VACUUM INTO '${beforePath.replace(/\\/g, "/")}'`);
  source.exec(`VACUUM INTO '${workPath.replace(/\\/g, "/")}'`);
  const startVersion = source.pragma("user_version", { simple: true });
  source.close();
  console.log(`\n1. snapshotted ${src} at user_version ${startVersion}`);

  const pre = new Database(beforePath, { readonly: true });
  const preKinds = Object.fromEntries(
    pre.prepare("SELECT name, type FROM sqlite_master WHERE name IN ('user_library','user_watchlist')").all()
      .map((r) => [r.name, r.type]),
  );
  const preCounts = {
    user_library: pre.prepare("SELECT COUNT(*) n FROM user_library").get().n,
    user_watchlist: pre.prepare("SELECT COUNT(*) n FROM user_watchlist").get().n,
    user_item_state: pre.prepare("SELECT COUNT(*) n FROM user_item_state").get().n,
    user_episode_state: pre.prepare("SELECT COUNT(*) n FROM user_episode_state").get().n,
    users: pre.prepare("SELECT COUNT(*) n FROM users").get().n,
    media_items: pre.prepare("SELECT COUNT(*) n FROM media_items").get().n,
  };
  console.log(`   before: ${JSON.stringify(preKinds)}  ${JSON.stringify(preCounts)}`);

  // ── 2. The standalone apply path, as a real subprocess ─────────────────────
  console.log(`\n2. node scripts/migrate.mjs ${path.basename(workPath)}`);
  let migrateOut = "";
  try {
    migrateOut = execFileSync(process.execPath, ["scripts/migrate.mjs", workPath], { encoding: "utf8" });
    check(true, "scripts/migrate.mjs exited 0");
  } catch (e) {
    migrateOut = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    check(false, "scripts/migrate.mjs exited 0", `exit ${e.status}`);
  }
  const applied = migrateOut.match(/"applied":\s*\[([^\]]*)\]/)?.[1]?.trim();
  console.log(`   applied: [${applied ?? "?"}]`);
  check(/\b16\b/.test(applied ?? ""), "migration 16 was applied");

  // ── 3. They are views now, and the rest of the DB is untouched ─────────────
  console.log(`\n3. post-migration shape`);
  const work = new Database(workPath);
  const postKinds = Object.fromEntries(
    work.prepare("SELECT name, type FROM sqlite_master WHERE name IN ('user_library','user_watchlist')").all()
      .map((r) => [r.name, r.type]),
  );
  check(postKinds.user_library === "view", "user_library is a view", postKinds.user_library);
  check(postKinds.user_watchlist === "view", "user_watchlist is a view", postKinds.user_watchlist);
  for (const t of ["user_item_state", "user_episode_state", "users", "media_items"]) {
    const n = work.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
    check(n === preCounts[t], `${t} row count unchanged`, `${preCounts[t]} -> ${n}`);
  }

  // A stale index on either name is the boot-killer this migration has to avoid:
  // CREATE INDEX over a view throws `views may not be indexed`, and db.ts's
  // schema block re-runs before migrations on EVERY boot.
  const strayIndexes = work.prepare(
    "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name IN ('user_library','user_watchlist')",
  ).all();
  check(strayIndexes.length === 0, "no leftover indexes on either name", strayIndexes.map((i) => i.name).join(", "));

  // ── 4. The rows themselves, before vs after ────────────────────────────────
  console.log(`\n4. row-for-row: pre-migration TABLE vs post-migration VIEW`);
  work.exec(`ATTACH DATABASE '${beforePath.replace(/\\/g, "/")}' AS pre`);

  const jsonEq = (a, b) => {
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    try { return JSON.stringify(JSON.parse(a)) === JSON.stringify(JSON.parse(b)); } catch { return a === b; }
  };

  const diff = (table, columns) => {
    const key = "user_id || ':' || media_item_id";
    const before = work.prepare(`SELECT ${key} AS k, * FROM pre.${table}`).all();
    const after = work.prepare(`SELECT * FROM (SELECT ${key} AS k, * FROM main.${table})`).all();
    const beforeBy = new Map(before.map((r) => [r.k, r]));
    const afterBy = new Map(after.map((r) => [r.k, r]));

    check(before.length === after.length, `${table}: same row count`, `${before.length} -> ${after.length}`);
    const missing = [...beforeBy.keys()].filter((k) => !afterBy.has(k));
    const extra = [...afterBy.keys()].filter((k) => !beforeBy.has(k));
    check(missing.length === 0, `${table}: no row disappeared`, missing.slice(0, 3).join(", "));
    check(extra.length === 0, `${table}: no row invented`, extra.slice(0, 3).join(", "));

    const bad = new Map();
    for (const [k, b] of beforeBy) {
      const a = afterBy.get(k);
      if (!a) continue;
      for (const c of columns) {
        const isJson = c === "platform_sources" || c === "metadata";
        if (!(isJson ? jsonEq(b[c], a[c]) : b[c] === a[c])) {
          if (!bad.has(c)) bad.set(c, []);
          bad.get(c).push({ k, before: b[c], after: a[c] });
        }
      }
    }
    for (const c of columns) {
      const list = bad.get(c) ?? [];
      check(list.length === 0, `${table}.${c}: identical on every row`,
        list.slice(0, 2).map((m) => `${m.k}: ${JSON.stringify(m.before)} -> ${JSON.stringify(m.after)}`).join(" | "));
    }
  };

  diff("user_watchlist", ["user_id", "media_item_id", "platform_sources", "added_at"]);
  diff("user_library", ["user_id", "media_item_id", "platform_sources", "status", "rating", "review", "reviewed_at", "metadata", "added_at"]);

  // ── 5. Re-running the migration is a no-op, not an error ───────────────────
  console.log(`\n5. idempotency`);
  try {
    execFileSync(process.execPath, ["scripts/migrate.mjs", workPath], { encoding: "utf8" });
    check(true, "a second migrate.mjs run succeeds");
  } catch (e) {
    check(false, "a second migrate.mjs run succeeds", `exit ${e.status}`);
  }
  const libAfterSecond = work.prepare("SELECT COUNT(*) n FROM user_library").get().n;
  check(libAfterSecond === preCounts.user_library, "library row count still matches after re-run",
    `${preCounts.user_library} -> ${libAfterSecond}`);

  work.close();
  pre.close();
} finally {
  cleanup();
}

console.log(
  problems.length
    ? `\nNOT CLEAN — ${problems.length} check(s) failed:\n  - ${problems.join("\n  - ")}\n`
    : `\nCLEAN — migration 16 applies through the standalone path and every library and wishlist row survives it unchanged.\n`,
);
process.exit(problems.length ? 1 : 0);
