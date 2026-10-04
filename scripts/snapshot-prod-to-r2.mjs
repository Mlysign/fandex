// Take a consistent snapshot of the Railway database, keep a copy locally, and
// put a copy in Cloudflare R2.
//
//   node scripts/snapshot-prod-to-r2.mjs            # snapshot, download, upload
//   node scripts/snapshot-prod-to-r2.mjs --no-upload   # local copy only
//
// Why this exists (2026-10-04): the Litestream replica lives in a bucket that
// was provisioned THROUGH Railway, so cancelling the Railway plan deletes the
// database and its only backup in one step. This is the copy that survives
// that. It is also where the D1 seed comes from (worker/scripts/build-seed.mjs).
//
// Needs `railway` logged in and linked (run from the repo root) and, for the
// upload, `wrangler` logged in (cd worker && npx wrangler login). No credential
// is read, printed or stored by this script; both CLIs use their own sessions.
//
// What it does on the box, in order:
//   1. VACUUM INTO a new file. A consistent copy of a live WAL-mode database
//      in one statement, and it reads only: Litestream and the app carry on.
//   2. gzip it, and checksum both files there.
//   3. Stream the .gz back as base64 (the SSH channel is not binary-safe).
//   4. Delete both files from the volume, whatever happened.
// Then locally: verify the checksum, unpack, check integrity, upload, and read
// the object back to verify it again.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import Database from "better-sqlite3";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, "data", "prod-snapshots");
const upload = !process.argv.includes("--no-upload");
const BUCKET = "fandex-backups";

const REMOTE_DB = "/app/data/rr.db";
const REMOTE_SNAP = "/app/data/snap-export.db";

// Runs inside the container, from /app so `better-sqlite3` resolves.
const SNAP_JS = `
const Database = require('better-sqlite3');
const fs = require('fs');
const out = '${REMOTE_SNAP}';
try { fs.unlinkSync(out); } catch {}
const db = new Database('${REMOTE_DB}', { readonly: true, fileMustExist: true });
db.exec("VACUUM INTO '" + out + "'");
const snap = new Database(out, { readonly: true });
console.log('SNAPSHOT ' + JSON.stringify({
  bytes: fs.statSync(out).size,
  integrity: snap.pragma('integrity_check', { simple: true }),
  userVersion: snap.pragma('user_version', { simple: true }),
}));
`;

function ssh(command) {
  // shell: true so the `railway` shim resolves on Windows. The command is ours,
  // built from constants above; nothing in it comes from outside this file.
  const res = spawnSync("railway", ["ssh", JSON.stringify(command)], { cwd: root, encoding: "utf8", shell: true, maxBuffer: 16 * 1024 * 1024 });
  if (res.status !== 0) throw new Error(`railway ssh failed: ${(res.stderr || res.stdout || "").trim().split("\n").slice(-3).join(" | ")}`);
  return res.stdout;
}

function sha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/** Stream a remote file back as base64 and decode it into `dest`. */
function download(remote, dest) {
  return new Promise((resolve, reject) => {
    const child = spawn("railway", ["ssh", JSON.stringify(`base64 -w0 ${remote}`)], { cwd: root, shell: true });
    const out = fs.createWriteStream(dest);
    let carry = "";
    child.stdout.setEncoding("latin1");
    child.stdout.on("data", (chunk) => {
      // base64 decodes in groups of four characters. Keep the remainder for the
      // next chunk, and drop anything the channel added (line breaks, CRs).
      const clean = (carry + chunk).replace(/[^A-Za-z0-9+/=]/g, "");
      const usable = clean.length - (clean.length % 4);
      carry = clean.slice(usable);
      if (usable) out.write(Buffer.from(clean.slice(0, usable), "base64"));
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (carry) out.write(Buffer.from(carry, "base64"));
      out.end(() => (code === 0 ? resolve() : reject(new Error(`download exited ${code}`))));
    });
  });
}

const stamp = new Date().toISOString().slice(0, 10);
fs.mkdirSync(outDir, { recursive: true });
const gzPath = path.join(outDir, `rr-${stamp}.db.gz`);
const dbPath = path.join(outDir, `rr-${stamp}.db`);

let remoteSha = null;
try {
  console.log("1/5 snapshot on the box…");
  const b64 = Buffer.from(SNAP_JS, "utf8").toString("base64");
  const snapOut = ssh(`echo ${b64} | base64 -d > /app/snap.js && cd /app && node snap.js; rm -f /app/snap.js`);
  const line = snapOut.split("\n").find((l) => l.startsWith("SNAPSHOT "));
  if (!line) throw new Error(`no snapshot report. Output: ${snapOut.trim().slice(-300)}`);
  const report = JSON.parse(line.slice("SNAPSHOT ".length));
  if (report.integrity !== "ok") throw new Error(`snapshot integrity_check: ${report.integrity}`);
  console.log(`    ${(report.bytes / 1e6).toFixed(1)} MB, integrity ok, user_version ${report.userVersion}`);

  console.log("2/5 compress and checksum…");
  const sums = ssh(`gzip -c ${REMOTE_SNAP} > ${REMOTE_SNAP}.gz && sha256sum ${REMOTE_SNAP}.gz`);
  remoteSha = (sums.match(/\b[0-9a-f]{64}\b/) ?? [])[0];
  if (!remoteSha) throw new Error("no checksum from the box");

  console.log("3/5 download…");
  await download(`${REMOTE_SNAP}.gz`, gzPath);
} finally {
  // Always, including after a failure above: a 240 MB file left on the volume
  // is a file somebody has to notice.
  try { ssh(`rm -f ${REMOTE_SNAP} ${REMOTE_SNAP}.gz`); } catch (e) { console.warn(`cleanup on the box failed: ${e.message}`); }
}

const localSha = sha256(gzPath);
if (localSha !== remoteSha) throw new Error(`checksum mismatch: box ${remoteSha}, local ${localSha}`);
console.log(`    ${(fs.statSync(gzPath).size / 1e6).toFixed(1)} MB, sha256 matches the box`);

console.log("4/5 unpack and verify…");
fs.writeFileSync(dbPath, zlib.gunzipSync(fs.readFileSync(gzPath)));
const local = new Database(dbPath, { readonly: true });
const integrity = local.pragma("integrity_check", { simple: true });
const counts = Object.fromEntries(
  ["users", "media_items", "media_links", "user_item_state", "user_episode_state"].map((t) => [t, local.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c]),
);
local.close();
if (integrity !== "ok") throw new Error(`local integrity_check: ${integrity}`);
console.log("    integrity ok,", JSON.stringify(counts));

if (upload) {
  console.log("5/5 upload to R2…");
  const key = `railway/rr-${stamp}.db.gz`;
  const wr = (args) => spawnSync("npx", ["wrangler", ...args], { cwd: path.join(root, "worker"), encoding: "utf8", shell: true });
  const put = wr(["r2", "object", "put", `${BUCKET}/${key}`, "--file", JSON.stringify(gzPath), "--jurisdiction", "eu", "--remote"]);
  if (put.status !== 0) throw new Error(`upload failed: ${(put.stderr || put.stdout).trim().split("\n").slice(-3).join(" | ")}`);
  const check = path.join(outDir, `.verify-${stamp}.gz`);
  const get = wr(["r2", "object", "get", `${BUCKET}/${key}`, "--file", JSON.stringify(check), "--jurisdiction", "eu", "--remote"]);
  if (get.status !== 0) throw new Error("uploaded, but could not read the object back to verify it");
  const r2Sha = sha256(check);
  fs.unlinkSync(check);
  if (r2Sha !== localSha) throw new Error(`R2 object differs from the local file: ${r2Sha}`);
  console.log(`    r2://${BUCKET}/${key}, read back and verified`);
} else {
  console.log("5/5 upload skipped (--no-upload)");
}

console.log(`done. Local copy: ${path.relative(root, dbPath)}`);
