// Hardened fetch for third-party APIs (P8). A drop-in superset of `fetch`:
// same signature and success behavior, but adds
//   - an abort TIMEOUT so a hung upstream can't block a request/sync forever, and
//   - bounded RETRIES with backoff for transient failures (network error / 5xx),
//     ONLY for idempotent methods (GET/HEAD) so we never double-submit a write.
//   - 429 (rate-limit) handling for idempotent methods: wait the server-requested
//     `Retry-After` (or a backoff) then retry, bounded — so bulk enrichment (e.g.
//     the ~1,700-item Trakt→TMDB sync) self-paces instead of silently dropping
//     the metadata for every rate-limited item. We only *wait then retry*, never
//     hammer immediately, and if the requested wait is too long we give up (the
//     caller treats a returned 429 as that one item failing, not the whole sync).
//   - an optional total-time BUDGET across all attempts (`budgetMs`), and
//   - a per-host CIRCUIT BREAKER (see below).
//
// Per-source failure isolation stays with the callers (each adapter/sync step
// already try/catches), so a timeout here surfaces as that one source failing,
// not the whole request.
//
// ── Why the breaker exists (2026-08-02) ──────────────────────────────────────
// We had per-source FAILURE isolation but no per-source LATENCY isolation. RAWG
// went down (Cloudflare 522 on every path, including rawg.io itself) and each
// call cost the full retry ladder — 20 s timeout × 3 attempts ≈ 60 s — on the
// REQUEST path, every time, for as long as the outage lasted. `fetchPages` fires
// 5 RAWG pages under one `Promise.all`, and `/api/home` reaches RAWG twice, so a
// cold `/api/home` measured **2.2 minutes** and a cold `/api/discover` 58–60 s.
// (That 58 s had been recorded in docs/archive/performance-audit.md as the catalog-pool
// cache re-parsing 39 MB — it is not: a full pool rebuild measures ~430 ms.)
//
// The breaker turns "pay the full ladder on every call" into "pay it once, then
// skip the host until it looks healthy again".
//
// ── The breaker THROWS; it never fabricates a response ───────────────────────
// Load-bearing, and the reason this is main-loop work: THE PRUNE INVARIANT
// (AGENTS.md) says a sync pull that fails must THROW, never return `[]`/partial,
// because `syncProvider` deletes every local entry missing from a "successful"
// pull. Returning a synthetic 503 Response here would have been the convenient
// choice — every browse fetcher already does `if (!res.ok) return []`, so it
// would have needed zero call-site changes — and it would ALSO have been read as
// `!res.ok` by the pull adapters, silently converting an outage into an empty
// library. Throwing is what keeps the two paths honest: pull adapters already
// throw on `!res.ok` (sources/rawg.ts et al), and the browse fetchers opt IN to
// degradation explicitly (discoverFeed.ts's `bestEffort`).

import { log } from "@/lib/logger";

export interface HttpFetchInit extends RequestInit {
  timeoutMs?: number;
  retries?: number;
  /**
   * Total wall-clock budget across ALL attempts (timeouts + backoff waits).
   * Unset = unbounded (the historical behavior), which is what the sync paths
   * want: they run off the request path and would rather wait than lose data.
   * Latency-sensitive callers pass a real budget — see BROWSE_BUDGET_MS.
   */
  budgetMs?: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const BACKOFF_MS = [200, 500]; // per-retry wait
const MAX_429_WAIT_MS = 10_000; // honor Retry-After up to this; a longer wait → give up (best-effort)

/**
 * The budget for a user-facing BROWSE fetch (discover/home/calendar feeds).
 * These paths are best-effort by construction — every one of them already
 * degrades to "this source contributed nothing this round" — so a dead provider
 * should cost a few seconds once, not the full retry ladder on every request.
 * Deliberately NOT the default: sync/pull must keep its generous budget.
 */
export const BROWSE_BUDGET_MS = 8_000;

// ── Circuit breaker ────────────────────────────────────────────────
const FAILURE_THRESHOLD = 3;   // consecutive hard failures before opening
const BASE_OPEN_MS = 30_000;   // first open window
const MAX_OPEN_MS = 5 * 60_000; // ceiling for the doubling on a failed probe

interface Breaker {
  failures: number;
  openUntil: number;
  openMs: number;
  probing: boolean;
}

// ⚠️ PINNED TO globalThis, AND THAT IS LOAD-BEARING (2026-08-20).
//
// Next does NOT give the server one module registry. A page route and an API
// route resolve `http.ts` into different bundles, so a plain `new Map()` here
// becomes SEVERAL maps — one per bundle — each with its own view of the world.
//
// Measured on prod, same cold-month workload through each path:
//
//                        rawg  tmdb  igdb
//   before                  1     2     1
//   after a PAGE route      1     2     1   ← its calls went somewhere else
//   after an API route      2     4     2
//
// Two consequences, and the second is the one that bites:
//
//   1. `/api/health` only ever showed the API-route copy. Every provider call
//      made while server-rendering a facet, item or calendar page — which is
//      the bulk of them — was invisible. That is why the memory note says
//      "`openProviderCircuits: {}` is not a health check": it was measuring one
//      half of the process.
//   2. The CIRCUIT BREAKER was per-bundle too. A dead provider had to fail
//      FAILURE_THRESHOLD times separately in each bundle before each stopped
//      calling it, so the breaker delivered a fraction of the protection it was
//      built for in 2026-08-02.
//
// `globalThis` is per-process, which is what both actually want. Keep any future
// cross-request state in http.ts on the same footing.
const _breakers: Map<string, Breaker> =
  ((globalThis as Record<string, unknown>).__fandexBreakers ??= new Map<string, Breaker>()) as Map<string, Breaker>;

// ── Per-host call counters (2026-08-20) ────────────────────────────
//
// Added because RAWG's monthly quota ran out and NOTHING in the app could say
// how, or which surface was spending it. `api.rawg.io` answered
// `401 {"error":"The monthly API limit reached"}` at what is still pre-launch
// traffic, and the only honest answer to "what burned 20,000 requests" was a
// shrug plus a plausible story about the crawler. A plausible story is exactly
// what has mis-diagnosed a resource ramp here twice.
//
// This counts **fetch attempts**, which is what a provider quota counts: a
// retried call is two requests upstream, so it is two here. `blocked` is the
// opposite — the breaker short-circuited and NO request left the process, so it
// costs no quota and is tracked separately rather than folded into the total.
//
// ⚠️ SINCE-BOOT, and a deploy resets it. That is fine for the question it
// answers (a RATE, and which host dominates) and useless for "how many did we
// send this calendar month". If the true monthly figure is ever needed, the
// shape to copy is migration 17's telemetry: one pre-aggregated row per
// (day, host), never a row per call. → [[telemetry-self-hosted]]
interface HostCalls {
  requests: number;
  ok: number;
  clientError: number;
  serverError: number;
  networkError: number;
  blocked: number;
  lastStatus: number | null;
}

// Same globalThis pinning as _breakers above, for the same reason — see there.
const _calls: Map<string, HostCalls> =
  ((globalThis as Record<string, unknown>).__fandexProviderCalls ??= new Map<string, HostCalls>()) as Map<string, HostCalls>;

function callsFor(host: string): HostCalls {
  let c = _calls.get(host);
  if (!c) {
    c = { requests: 0, ok: 0, clientError: 0, serverError: 0, networkError: 0, blocked: 0, lastStatus: null };
    _calls.set(host, c);
  }
  return c;
}

/**
 * Per-host provider call volume since boot, for `/api/health`.
 *
 * `projectedPerMonth` extrapolates the since-boot rate over 730 h. It is a
 * back-of-envelope figure and says so — on a young process it is wildly
 * sensitive to whatever happened in the first minutes (a sync, a crawl burst).
 * Read it against `uptimeSec`, and distrust it under an hour.
 */
export function providerCallSnapshot(): Record<string, HostCalls & { projectedPerMonth: number }> {
  const uptimeSec = Math.max(process.uptime(), 1);
  const out: Record<string, HostCalls & { projectedPerMonth: number }> = {};
  for (const [host, c] of _calls) {
    out[host] = { ...c, projectedPerMonth: Math.round((c.requests / uptimeSec) * 3600 * 730) };
  }
  return out;
}

/** Test-only: counters are module-global and would leak across cases. */
export function __resetProviderCalls() { _calls.clear(); }

/** Thrown instead of making a request while a host's breaker is open. */
// ⚠️ The fields are declared and assigned explicitly rather than with TypeScript
// PARAMETER PROPERTIES (`constructor(readonly host: string, …)`). Same class of
// trap as AGENTS.md's `import type` rule: Node's native type-stripping — what
// scripts/alias-hooks.mjs gives every standalone rehearse-*/calibrate-*/probe-*
// script — only ERASES type syntax, it never emits code, so a parameter property
// (which has to generate an assignment) is rejected outright with
// ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX. That killed any script reaching a provider
// path the moment it imported http.ts, while tsc, vitest, next dev and next
// build all compiled it happily.
export class ProviderUnavailableError extends Error {
  readonly host: string;
  readonly retryInMs: number;
  constructor(host: string, retryInMs: number) {
    super(`Provider ${host} is unavailable (circuit open, retry in ${Math.ceil(retryInMs / 1000)}s)`);
    this.name = "ProviderUnavailableError";
    this.host = host;
    this.retryInMs = retryInMs;
  }
}

function hostOf(input: string | URL): string | null {
  try { return new URL(input).host || null; } catch { return null; }
}

function breakerFor(host: string): Breaker {
  let b = _breakers.get(host);
  if (!b) { b = { failures: 0, openUntil: 0, openMs: BASE_OPEN_MS, probing: false }; _breakers.set(host, b); }
  return b;
}

/**
 * Gate a request. Returns true when this call is the half-open PROBE (its
 * outcome decides whether the breaker closes), false for a normal call.
 * Throws ProviderUnavailableError while the breaker is open.
 */
function enterBreaker(host: string): boolean {
  const b = breakerFor(host);
  if (b.openUntil === 0) return false;

  const now = Date.now();
  if (now < b.openUntil) { callsFor(host).blocked++; throw new ProviderUnavailableError(host, b.openUntil - now); }

  // Half-open: let exactly ONE probe through; everyone else still fails fast,
  // so a burst of parallel callers can't re-flood a host that's still down.
  if (b.probing) { callsFor(host).blocked++; throw new ProviderUnavailableError(host, BASE_OPEN_MS); }
  b.probing = true;
  return true;
}

function recordSuccess(host: string, wasProbe: boolean) {
  const b = breakerFor(host);
  if (b.openUntil !== 0 || b.failures !== 0) {
    log.info("provider_circuit_closed", { host, afterFailures: b.failures });
  }
  b.failures = 0;
  b.openUntil = 0;
  b.openMs = BASE_OPEN_MS;
  if (wasProbe) b.probing = false;
}

function recordFailure(host: string, wasProbe: boolean, reason: string) {
  const b = breakerFor(host);
  if (wasProbe) {
    // The probe failed — still down. Back off harder, up to the ceiling.
    b.probing = false;
    b.openMs = Math.min(b.openMs * 2, MAX_OPEN_MS);
    b.openUntil = Date.now() + b.openMs;
    log.warn("provider_circuit_reopened", { host, openMs: b.openMs, reason });
    return;
  }
  b.failures++;
  if (b.failures >= FAILURE_THRESHOLD && b.openUntil === 0) {
    b.openUntil = Date.now() + b.openMs;
    log.warn("provider_circuit_opened", { host, failures: b.failures, openMs: b.openMs, reason });
  }
}

/**
 * Is this host's breaker OPEN right now — i.e. do we already know that a call
 * to it will fail without being made?
 *
 * Read-only: it never opens, closes, or consumes the half-open probe, so asking
 * cannot change what the next real call does. It exists so a caller that would
 * otherwise start a doomed request can skip it and report "unavailable"
 * HONESTLY, rather than discovering the outage by catching a throw and then
 * being unable to tell that outcome apart from "nothing needed doing" (see
 * healLinks in detail/enrich.ts — that ambiguity is what turned a dead provider
 * into a permanently score-less card).
 *
 * Note it stays false during the half-open window: the probe is how the breaker
 * recovers, so it must not be skipped. A caller that can't afford to pay for one
 * needs a deadline too, not just this check.
 */
export function isProviderCircuitOpen(host: string): boolean {
  const b = _breakers.get(host);
  return !!b && b.openUntil > Date.now();
}

/** Open breakers, for /api/health. Empty object = every provider looks healthy. */
export function providerBreakerSnapshot(): Record<string, { openForMs: number; failures: number }> {
  const now = Date.now();
  const out: Record<string, { openForMs: number; failures: number }> = {};
  for (const [host, b] of _breakers) {
    if (b.openUntil > now) out[host] = { openForMs: b.openUntil - now, failures: b.failures };
  }
  return out;
}

/** Test-only: breaker state is module-global and would leak across test cases. */
export function __resetBreakers() { _breakers.clear(); }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Retry-After is seconds (or an HTTP date, which we ignore → fall back to backoff).
function retryAfterMs(res: Response, attempt: number): number {
  const secs = Number(res.headers.get("retry-after"));
  return Number.isFinite(secs) && secs > 0 ? secs * 1000 : (BACKOFF_MS[attempt] ?? 500);
}

export async function httpFetch(input: string | URL, init: HttpFetchInit = {}): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, retries, budgetMs, ...rest } = init;
  const method = (rest.method ?? "GET").toUpperCase();
  const idempotent = method === "GET" || method === "HEAD";
  const maxRetries = retries ?? (idempotent ? 2 : 0);

  const host = hostOf(input);
  const isProbe = host ? enterBreaker(host) : false;

  const startedAt = Date.now();
  // Infinity when no budget was given — every comparison below then behaves
  // exactly as it did before budgets existed.
  const remaining = () => (budgetMs == null ? Infinity : budgetMs - (Date.now() - startedAt));

  const fail = (reason: string) => { if (host) recordFailure(host, isProbe, reason); };
  const ok = () => { if (host) recordSuccess(host, isProbe); };

  try {
    for (let attempt = 0; ; attempt++) {
      // A budget that's already spent means we never even start this attempt.
      const perAttempt = Math.min(timeoutMs, remaining());
      if (perAttempt <= 0) {
        fail("budget_exhausted");
        throw new Error(`httpFetch budget of ${budgetMs}ms exhausted for ${host ?? input}`);
      }

      try {
        // Counted BEFORE the await: an attempt that times out still left the
        // process and still cost the provider a request against our quota.
        if (host) callsFor(host).requests++;
        const res = await fetch(input, { ...rest, signal: AbortSignal.timeout(perAttempt) });
        if (host) {
          const c = callsFor(host);
          c.lastStatus = res.status;
          if (res.status >= 500) c.serverError++;
          else if (res.status >= 400) c.clientError++;
          else c.ok++;
        }
        if (attempt < maxRetries) {
          // Transient server errors: back off and retry.
          if (res.status >= 500) {
            const wait = BACKOFF_MS[attempt] ?? 500;
            if (wait < remaining()) { await sleep(wait); continue; }
          }
          // Rate-limited: wait the requested time (bounded) then retry, idempotent only.
          if (res.status === 429 && idempotent) {
            const waitMs = retryAfterMs(res, attempt);
            if (waitMs <= MAX_429_WAIT_MS && waitMs < remaining()) { await sleep(waitMs); continue; }
          }
        }
        // A 5xx we've stopped retrying is an outage signal; a 4xx (including a
        // 429 we chose not to wait out) is the provider working as designed and
        // must NOT open the breaker — that would let our own burst rate, or one
        // bad request, take a healthy host offline for everyone.
        if (res.status >= 500) fail(`status_${res.status}`); else ok();
        return res;
      } catch (e) {
        if (host) callsFor(host).networkError++;
        // AbortError (timeout) or a network failure. Retry idempotent requests.
        if (attempt < maxRetries) {
          const wait = BACKOFF_MS[attempt] ?? 500;
          if (wait < remaining()) { await sleep(wait); continue; }
        }
        fail(e instanceof Error ? e.name : "network");
        throw e;
      }
    }
  } finally {
    // A probe that threw before reaching recordFailure/recordSuccess (only
    // possible on a programming error) must not pin the breaker half-open
    // forever, blocking every future probe.
    if (isProbe && host) {
      const b = breakerFor(host);
      if (b.probing) b.probing = false;
    }
  }
}
