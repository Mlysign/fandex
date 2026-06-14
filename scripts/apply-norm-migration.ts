// One-off: apply pending DB migrations (currently the norm_title re-backfill for
// the NORM_VERSION bump) to the real data/rr.db and print a verification summary.
// Safe to re-run — initDb()'s user_version guard makes it idempotent.
import { initDb, getDb } from "../src/lib/db";

initDb();
const db = getDb();

const userVersion = db.pragma("user_version", { simple: true });
const total = (db.prepare("SELECT COUNT(*) c FROM media_items").get() as { c: number }).c;
const missing = (db.prepare("SELECT COUNT(*) c FROM media_items WHERE norm_title IS NULL OR norm_title = ''").get() as { c: number }).c;
const samples = db
  .prepare("SELECT title, norm_title FROM media_items WHERE title LIKE '%-%' OR title LIKE '%''%' ORDER BY title LIMIT 10")
  .all();

console.log(JSON.stringify({ userVersion, total, missingNormTitle: missing, samples }, null, 2));
