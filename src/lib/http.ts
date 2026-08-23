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
  /**
   * True when the ONLY credential this request carries is the APP's own - an
   * API key, a `client_credentials` token - and no per-user token.
   *
   * It gates the 401/403 AUTH LATCH below, and the default is deliberately
   * false. A 401 on a request carrying a USER's token means that one user's
   * token is dead; latching the host on it would stop the provider for
   * everybody else. Opting in per CALL SITE rather than per host is the only
   * honest split, because RAWG and TMDB serve both kinds of request from the
   * same host.
   *
   * Forgetting it on a new app-scoped call site costs wasted requests, which is
   * the safe direction. Setting it on a user-scoped one is the bug.
   */
  appScopedAuth?: boolean;
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

// -- The 401/403 auth latch (2026-08-22) ----------------------------
//
// A 4xx deliberately does NOT open the breaker above: our own bad request must
// not take a healthy host offline for everyone. That rule is right for a ONE-OFF
// 4xx and wrong for a persistent one. Measured on prod over 10.5 h: 13,068
// requests to RAWG, 4,343 to OMDb, 3,155 to Letterboxd, and every single one
// returned 401. About a third of all provider traffic, re-asked roughly 2,000
// times an hour forever, with nothing in the app learning from it. A 401
// repeated 13,068 times is a dead credential, not a bad request.
//
// So: after AUTH_FAILURE_THRESHOLD consecutive 401/403s on APP-scoped requests
// (see `appScopedAuth` - a single user's dead token must never latch a host for
// everybody), the host's breaker opens on a much longer schedule than an outage
// gets. It still recovers on its own: one half-open probe per window, doubling
// to AUTH_MAX_OPEN_MS on each failed probe. RAWG's quota resets monthly, so the
// worst case is games metadata staying off for up to 6 h into the new month,
// against ~5,600 wasted calls a day. That is the right trade.
//
// Any response that is not a 401/403 resets the run (`recordSuccess`), so a
// provider that starts answering is picked straight back up. A network error
// leaves the run alone: it says nothing about the credential.
const AUTH_FAILURE_THRESHOLD = 5;
const AUTH_OPEN_MS = 15 * 60_000;
const AUTH_MAX_OPEN_MS = 6 * 60 * 60_000;

interface Breaker {
  failures: number;
  /** Consecutive 401/403s on APP-scoped requests. Reset by any other response. */
  authFailures: number;
  openUntil: number;
  openMs: number;
  /** Ceiling for the probe backoff doubling. Raised while latched on auth. */
  maxOpenMs: number;
  /** Why this breaker is open: an outage, or a credential the provider rejects. */
  latchedOnAuth: boolean;
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

// ── Per-host CONCURRENCY gate (2026-08-23) ─────────────────────────
//
// A different failure from the breaker, and the breaker cannot fix it: this is
// about OUR request rate being too high for a provider, not about the provider
// being down.
//
// IGDB documents a hard **4 requests per second**. `liveDiscover` fans out
// PAGES_PER_SOURCE pages under one `Promise.all`, several surfaces can do that
// at once, and the franchise sweep adds more — so we routinely exceed it.
// Measured on prod: **64 network errors out of 175 IGDB requests**, plus 230
// further calls blocked by the breaker those failures had opened. An earlier
// reading in docs/scalability.md §1a was worse: 190 of 232.
//
// That is a CATALOG COMPLETENESS problem, not just a latency one — with RAWG's
// monthly quota exhausted, IGDB is the only games metadata source we have, so a
// third of games lookups failing is a third of games data missing.
//
// ⚠️ THE FIX IS FEWER CONCURRENT REQUESTS, NOT MORE RETRIES. A retry ladder
// against a rate limit makes the rate worse, which is how 190-of-232 happens.
//
// ⚠️ THE GATE IS TAKEN AROUND THE WHOLE RETRY LOOP, not per attempt. A retry is
// part of the same logical request and must not have to re-queue behind a burst
// that arrived while it was backing off.
//
// ⚠️ Pinned to globalThis for the reason `_breakers` is — a per-bundle
// semaphore would let each Next bundle run its own 4, which is 4 x nothing.
//
// Honest about what is measured: the numbers above predate the browse page
// cache (2026-08-23), which cut IGDB volume substantially, so the CURRENT error
// rate is unmeasured. This is justified by the documented limit and the visible
// fan-out rather than by a fresh reading; `maxQueued`/`maxInFlight` in the
// health snapshot are what will settle it.
const HOST_CONCURRENCY: Record<string, number> = {
  "api.igdb.com": 4,
};

interface Gate {
  limit: number;
  inFlight: number;
  waiters: (() => void)[];
  /** High-water marks since boot, for the health snapshot. */
  maxInFlight: number;
  maxQueued: number;
  /** Total acquisitions that had to wait. Zero means the gate is not binding. */
  queuedTotal: number;
}

const _gates: Map<string, Gate> =
  ((globalThis as Record<string, unknown>).__fandexHostGates ??= new Map<string, Gate>()) as Map<string, Gate>;

function gateFor(host: string): Gate | null {
  const limit = HOST_CONCURRENCY[host];
  if (!limit) return null;
  let g = _gates.get(host);
  if (!g) {
    g = { limit, inFlight: 0, waiters: [], maxInFlight: 0, maxQueued: 0, queuedTotal: 0 };
    _gates.set(host, g);
  }
  return g;
}

async function acquire(g: Gate): Promise<void> {
  if (g.inFlight < g.limit) {
    g.inFlight++;
    if (g.inFlight > g.maxInFlight) g.maxInFlight = g.inFlight;
    return;
  }
  g.queuedTotal++;
  if (g.waiters.length + 1 > g.maxQueued) g.maxQueued = g.waiters.length + 1;
  await new Promise<void>((res) => g.waiters.push(res));
  g.inFlight++;
  if (g.inFlight > g.maxInFlight) g.maxInFlight = g.inFlight;
}

function release(g: Gate): void {
  g.inFlight--;
  const next = g.waiters.shift();
  // The waiter increments inFlight itself when it resumes, so this only hands
  // over the right to do so. Releasing in a `finally` is what makes a throw
  // (timeout, breaker, budget) unable to leak a permanently-held slot.
  if (next) next();
}

/** Test seam: forget every gate. */
export function __resetHostGates(): void {
  _gates.clear();
}

export function hostGateSnapshot(): Record<string, { limit: number; inFlight: number; queued: number; maxInFlight: number; maxQueued: number; queuedTotal: number }> {
  const out: Record<string, { limit: number; inFlight: number; queued: number; maxInFlight: number; maxQueued: number; queuedTotal: number }> = {};
  for (const [host, g] of _gates) {
    out[host] = {
      limit: g.limit, inFlight: g.inFlight, queued: g.waiters.length,
      maxInFlight: g.maxInFlight, maxQueued: g.maxQueued, queuedTotal: g.queuedTotal,
    };
  }
  return out;
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
  /** "auth" = the provider rejects our credential; "circuit" = it looks down. */
  readonly reason: "circuit" | "auth";
  constructor(host: string, retryInMs: number, reason: "circuit" | "auth" = "circuit") {
    const why = reason === "auth" ? "credential rejected" : "circuit open";
    super(`Provider ${host} is unavailable (${why}, retry in ${Math.ceil(retryInMs / 1000)}s)`);
    this.name = "ProviderUnavailableError";
    this.host = host;
    this.retryInMs = retryInMs;
    this.reason = reason;
  }
}

function hostOf(input: string | URL): string | null {
  try { return new URL(input).host || null; } catch { return null; }
}

function breakerFor(host: string): Breaker {
  let b = _breakers.get(host);
  if (!b) {
    b = { failures: 0, authFailures: 0, openUntil: 0, openMs: BASE_OPEN_MS, maxOpenMs: MAX_OPEN_MS, latchedOnAuth: false, probing: false };
    _breakers.set(host, b);
  }
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
  if (now < b.openUntil) {
    callsFor(host).blocked++;
    throw new ProviderUnavailableError(host, b.openUntil - now, b.latchedOnAuth ? "auth" : "circuit");
  }

  // Half-open: let exactly ONE probe through; everyone else still fails fast,
  // so a burst of parallel callers can't re-flood a host that's still down.
  if (b.probing) {
    callsFor(host).blocked++;
    throw new ProviderUnavailableError(host, b.openMs, b.latchedOnAuth ? "auth" : "circuit");
  }
  b.probing = true;
  return true;
}

function recordSuccess(host: string, wasProbe: boolean) {
  const b = breakerFor(host);
  if (b.openUntil !== 0 || b.failures !== 0) {
    log.info("provider_circuit_closed", { host, afterFailures: b.failures });
  }
  b.failures = 0;
  b.authFailures = 0;
  b.openUntil = 0;
  b.openMs = BASE_OPEN_MS;
  b.maxOpenMs = MAX_OPEN_MS;
  b.latchedOnAuth = false;
  if (wasProbe) b.probing = false;
}

function recordFailure(host: string, wasProbe: boolean, reason: string) {
  const b = breakerFor(host);
  if (wasProbe) {
    // The probe failed — still down. Back off harder, up to the ceiling.
    b.probing = false;
    b.openMs = Math.min(b.openMs * 2, b.maxOpenMs);
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
 * A 401/403 on an APP-scoped request: the provider is up and rejecting our own
 * credential. Counted separately from an outage and latched on a much longer
 * schedule - see AUTH_FAILURE_THRESHOLD above for why.
 */
function recordAuthFailure(host: string, wasProbe: boolean, status: number) {
  const b = breakerFor(host);
  if (wasProbe) {
    // The probe was rejected too, so the credential is still dead. Back off
    // harder, up to the auth ceiling.
    b.probing = false;
    b.openMs = Math.min(b.openMs * 2, b.maxOpenMs);
    b.openUntil = Date.now() + b.openMs;
    log.warn("provider_auth_latch_held", { host, status, openMs: b.openMs });
    return;
  }
  b.authFailures++;
  if (b.authFailures >= AUTH_FAILURE_THRESHOLD && b.openUntil === 0) {
    b.latchedOnAuth = true;
    b.maxOpenMs = AUTH_MAX_OPEN_MS;
    b.openMs = AUTH_OPEN_MS;
    b.openUntil = Date.now() + b.openMs;
    log.warn("provider_auth_latched", { host, status, authFailures: b.authFailures, openMs: b.openMs });
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
interface BreakerReport {
  openForMs: number;
  failures: number;
  authFailures: number;
  /** True = the provider is up and rejecting our credential, not down. */
  latchedOnAuth: boolean;
}

export function providerBreakerSnapshot(): Record<string, BreakerReport> {
  const now = Date.now();
  const out: Record<string, BreakerReport> = {};
  for (const [host, b] of _breakers) {
    if (b.openUntil > now) {
      out[host] = {
        openForMs: b.openUntil - now,
        failures: b.failures,
        authFailures: b.authFailures,
        latchedOnAuth: b.latchedOnAuth,
      };
    }
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
  const { timeoutMs = DEFAULT_TIMEOUT_MS, retries, budgetMs, appScopedAuth, ...rest } = init;
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
  const failAuth = (status: number) => { if (host) recordAuthFailure(host, isProbe, status); };
  const ok = () => { if (host) recordSuccess(host, isProbe); };

  // Rate gate, for hosts that publish one (IGDB: 4 req/s). Taken around the
  // WHOLE retry loop and released in the finally below, so a throw anywhere —
  // timeout, budget exhaustion, breaker — cannot leak a slot. See the block
  // comment on HOST_CONCURRENCY.
  //
  // Acquired AFTER the breaker check above on purpose: a host whose breaker is
  // open should be refused immediately, not made to queue for a slot it is
  // about to be denied anyway.
  const gate = host ? gateFor(host) : null;
  if (gate) await acquire(gate);

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
        //
        // The one exception is a 401/403 on an APP-scoped request, repeated:
        // that is not our burst rate and not one bad request, it is a credential
        // the provider has stopped accepting. See the auth latch above.
        if (res.status >= 500) fail(`status_${res.status}`);
        else if (appScopedAuth && (res.status === 401 || res.status === 403)) failAuth(res.status);
        else ok();
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
    // Hand the rate-gate slot on before anything else can throw. A leaked slot
    // is unrecoverable without a restart: the gate would run one permit short
    // for the life of the process, and at limit 4 that is a 25% throughput cut
    // nothing reports.
    if (gate) release(gate);
    // A probe that threw before reaching recordFailure/recordSuccess (only
    // possible on a programming error) must not pin the breaker half-open
    // forever, blocking every future probe.
    if (isProbe && host) {
      const b = breakerFor(host);
      if (b.probing) b.probing = false;
    }
  }
}
