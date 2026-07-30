// Route timing probe — TTFB + payload size per route, cold and warm.
//
// Exists because the performance audit needs numbers rather than adjectives, and
// because "it feels slow" and "it IS slow" have diverged here before: the
// 2026-07-21 memory incident was diagnosed as a JS leak for a while when it was
// sharp decoding native memory, and the 2026-07-27 sweep read a fetch-heavy hub
// as "never built" because it waited 5s instead of 8.
//
// Usage:
//   node scripts/perf-probe.mjs                       # localhost:3000, anon
//   node scripts/perf-probe.mjs --cookie "rr2_session=…"   # authed routes too
//   node scripts/perf-probe.mjs --base http://localhost:3001 --json out.json
//
// COLD vs WARM matters more than the absolute numbers on a dev server: Next
// compiles each route on first hit, so a cold figure is mostly compile time. The
// warm column is the one to compare across a change; the cold one is only useful
// as "did this route get a whole new dependency tree".
//
// Plain Node, no app imports — nothing here needs the `@/*` alias, so it does not
// need scripts/alias-hooks.mjs (see migrations.ts's app-import rule for why that
// distinction is load-bearing).

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const BASE = argOf("--base", "http://localhost:3000").replace(/\/$/, "");
const COOKIE = argOf("--cookie", process.env.PERF_PROBE_COOKIE ?? "");
const JSON_OUT = argOf("--json", null);

// The routes that actually cost something. API routes first (they're what the
// pages wait on), then the SSR pages.
const ROUTES = [
  // Public
  { path: "/api/home", auth: false },
  { path: "/api/discover", auth: false },
  { path: "/", auth: false },
  { path: "/discover", auth: false },
  { path: "/robots.txt", auth: false },
  // Authed — skipped without a cookie
  { path: "/api/library", auth: true },
  { path: "/api/insights", auth: true },
  { path: "/api/calendar", auth: true },
  { path: "/api/facet/mine", auth: true },
  { path: "/library", auth: true },
  { path: "/insights", auth: true },
  { path: "/calendar", auth: true },
  { path: "/profile", auth: true },
];

async function probe(path) {
  const started = process.hrtime.bigint();
  let res;
  try {
    res = await fetch(BASE + path, {
      headers: COOKIE ? { cookie: COOKIE } : {},
      redirect: "manual",
    });
  } catch (e) {
    return { error: String(e.message ?? e) };
  }
  // TTFB proxy: fetch() resolves on headers, so this is close enough for a
  // relative comparison and needs no instrumentation in the app.
  const ttfbMs = Number(process.hrtime.bigint() - started) / 1e6;
  const body = await res.arrayBuffer();
  const totalMs = Number(process.hrtime.bigint() - started) / 1e6;
  return {
    status: res.status,
    ttfbMs: Math.round(ttfbMs),
    totalMs: Math.round(totalMs),
    bytes: body.byteLength,
    kb: Math.round(body.byteLength / 1024),
  };
}

const results = [];
for (const route of ROUTES) {
  if (route.auth && !COOKIE) {
    results.push({ path: route.path, skipped: "needs --cookie" });
    continue;
  }
  const cold = await probe(route.path);
  const warm = await probe(route.path);
  const warm2 = await probe(route.path);
  results.push({
    path: route.path,
    status: cold.status ?? null,
    error: cold.error ?? warm.error ?? null,
    coldMs: cold.totalMs ?? null,
    // Best of two warm hits — a dev server's first warm hit still pays some
    // lazy-init cost, and one outlier shouldn't become the headline number.
    warmMs: Math.min(warm.totalMs ?? Infinity, warm2.totalMs ?? Infinity),
    kb: warm.kb ?? cold.kb ?? null,
  });
}

const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);
console.log(`\n${pad("route", 22)} ${padL("status", 6)} ${padL("cold ms", 8)} ${padL("warm ms", 8)} ${padL("KB", 7)}`);
console.log("-".repeat(56));
for (const r of results) {
  if (r.skipped) { console.log(`${pad(r.path, 22)} ${padL("—", 6)}   ${r.skipped}`); continue; }
  if (r.error) { console.log(`${pad(r.path, 22)} ${padL("ERR", 6)}   ${r.error}`); continue; }
  console.log(`${pad(r.path, 22)} ${padL(r.status, 6)} ${padL(r.coldMs, 8)} ${padL(r.warmMs === Infinity ? "—" : r.warmMs, 8)} ${padL(r.kb, 7)}`);
}
console.log();

if (JSON_OUT) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(JSON_OUT, JSON.stringify({ base: BASE, authed: !!COOKIE, results }, null, 2));
  console.log(`wrote ${JSON_OUT}\n`);
}
