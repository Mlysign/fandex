import fs from "fs";
import path from "path";

// Container-level memory forensics (2026-07-22).
//
// Railway graphs the CONTAINER's memory, not the Node process's. Those are very
// different numbers here, because the container runs two processes plus a page
// cache: `litestream replicate -exec "node server.js"` (docker-entrypoint.sh).
// When the dashboard showed a 500MB→2GB overnight ramp while /api/health
// reported a flat 354MB RSS / 100MB heap, there was no way to tell from outside
// whether the missing ~1.7GB was Litestream, allocator slack, or reclaimable
// kernel page cache from SQLite I/O. This module closes that gap.
//
// Everything here is best-effort and Linux-only: on Windows/macOS dev machines
// the /sys and /proc reads simply fail and the caller gets nulls.

const PAGE_SIZE = 4096;

function readFileSafe(p: string): string | null {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

function parseKeyedStat(raw: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const line of raw.split("\n")) {
    const [k, v] = line.trim().split(/\s+/);
    if (k && v !== undefined) {
      const n = Number(v);
      if (Number.isFinite(n)) out[k] = n;
    }
  }
  return out;
}

export type CgroupMemory = {
  version: 1 | 2;
  /** Total charged to the cgroup — this is what Railway bills and graphs. */
  currentMb: number | null;
  limitMb: number | null;
  /** Process memory (heaps, stacks, allocator arenas). NOT reclaimable. */
  anonMb: number | null;
  /** Kernel page cache for files this cgroup touched (rr.db, -wal, WAL
   *  segments). Reclaimable under pressure — counted, but not a leak. */
  fileMb: number | null;
  slabMb: number | null;
  sockMb: number | null;
};

/**
 * Read the container's own memory accounting. cgroup v2 first (what Railway
 * runs), falling back to v1 layout.
 */
export function readCgroupMemory(): CgroupMemory | null {
  const mb = (bytes: number | undefined) =>
    bytes === undefined || !Number.isFinite(bytes)
      ? null
      : Math.round(bytes / 1048576);

  // ── cgroup v2 ──
  const v2Current = readFileSafe("/sys/fs/cgroup/memory.current");
  const v2Stat = readFileSafe("/sys/fs/cgroup/memory.stat");
  if (v2Current && v2Stat) {
    const s = parseKeyedStat(v2Stat);
    const rawMax = readFileSafe("/sys/fs/cgroup/memory.max")?.trim();
    return {
      version: 2,
      currentMb: mb(Number(v2Current.trim())),
      limitMb: rawMax && rawMax !== "max" ? mb(Number(rawMax)) : null,
      anonMb: mb(s.anon),
      fileMb: mb(s.file),
      slabMb: mb(s.slab),
      sockMb: mb(s.sock),
    };
  }

  // ── cgroup v1 ──
  const v1Usage = readFileSafe("/sys/fs/cgroup/memory/memory.usage_in_bytes");
  const v1Stat = readFileSafe("/sys/fs/cgroup/memory/memory.stat");
  if (v1Usage && v1Stat) {
    const s = parseKeyedStat(v1Stat);
    const rawLimit = readFileSafe(
      "/sys/fs/cgroup/memory/memory.limit_in_bytes",
    )?.trim();
    const limit = rawLimit ? Number(rawLimit) : NaN;
    return {
      version: 1,
      currentMb: mb(Number(v1Usage.trim())),
      // v1 reports "no limit" as a huge sentinel rather than a keyword.
      limitMb: Number.isFinite(limit) && limit < 2 ** 62 ? mb(limit) : null,
      anonMb: mb(s.total_rss ?? s.rss),
      fileMb: mb(s.total_cache ?? s.cache),
      slabMb: null,
      sockMb: null,
    };
  }

  return null;
}

export type ProcessRss = {
  /** Bucketed deliberately — this endpoint is public, so no raw cmdlines. */
  name: "node" | "litestream" | "other";
  rssMb: number;
  pid: number;
};

/**
 * Per-process RSS for everything in the container's PID namespace. Answers
 * "is the gap Litestream?" directly.
 */
export function readProcessRss(): ProcessRss[] | null {
  let pids: string[];
  try {
    pids = fs.readdirSync("/proc").filter((d) => /^\d+$/.test(d));
  } catch {
    return null;
  }

  const out: ProcessRss[] = [];
  for (const pid of pids) {
    // A process can exit between readdir and read — skip it, don't fail.
    const statm = readFileSafe(`/proc/${pid}/statm`);
    if (!statm) continue;
    const resident = Number(statm.trim().split(/\s+/)[1]);
    if (!Number.isFinite(resident)) continue;

    const comm = (readFileSafe(`/proc/${pid}/comm`) ?? "").trim();
    const name =
      comm === "node" ? "node" : comm === "litestream" ? "litestream" : "other";

    out.push({ name, pid: Number(pid), rssMb: Math.round((resident * PAGE_SIZE) / 1048576) });
  }
  return out.sort((a, b) => b.rssMb - a.rssMb);
}

function sizeMb(p: string): number | null {
  try {
    return Math.round((fs.statSync(p).size / 1048576) * 10) / 10;
  } catch {
    return null;
  }
}

export type DbFootprint = {
  dbMb: number | null;
  /** A WAL that keeps growing means checkpoints aren't landing — Litestream
   *  holds a read lock that defers them, so this is the number to watch. */
  walMb: number | null;
  shmMb: number | null;
  /** Litestream's shadow WAL dir. Grows without bound if replication stalls. */
  shadowWalMb: number | null;
};

/** On-disk footprint of the SQLite DB and Litestream's shadow WAL. */
export function readDbFootprint(): DbFootprint {
  const dbPath = process.env.DB_PATH || path.join(process.cwd(), "data", "rr.db");
  const shadowDir = path.join(
    path.dirname(dbPath),
    `.${path.basename(dbPath)}-litestream`,
  );

  let shadowWalMb: number | null = null;
  try {
    let total = 0;
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else total += fs.statSync(full).size;
      }
    };
    walk(shadowDir);
    shadowWalMb = Math.round((total / 1048576) * 10) / 10;
  } catch {
    shadowWalMb = null;
  }

  return {
    dbMb: sizeMb(dbPath),
    walMb: sizeMb(`${dbPath}-wal`),
    shmMb: sizeMb(`${dbPath}-shm`),
    shadowWalMb,
  };
}
