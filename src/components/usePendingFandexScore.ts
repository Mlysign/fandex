"use client";
import { useEffect, useState } from "react";

// 2026-07-29 — client half of the facet-source fix (see liveDiscover.ts's
// `catalogFacets` and /api/discover/scores).
//
// A live feed leaves an item UNSCORED and `fandexPending` when its local row is
// still thin (genre tags only), rather than rendering a number we know is
// depressed. Every card in that state registers here; one shared, debounced
// request heals and scores the whole visible batch, and each card paints its
// own result when it lands.
//
// Batched at MODULE scope, exactly like TagCategoryPicker's admin-state fetch:
// a rail of 20 pending cards must produce ONE request, not 20. Without that,
// the fan-out this fix exists to avoid just moves to the client.

const ENDPOINT = "/api/discover/scores";
// Matches the route's own MAX_IDS. Anything over that comes back in `skipped`
// and is retried on the next flush rather than dropped.
const MAX_PER_REQUEST = 24;
// One frame's worth of card mounts, so a whole rail coalesces into one call.
const DEBOUNCE_MS = 80;

// 2026-08-13 (SM44) — the route can now answer "not yet" for an id it couldn't
// heal inside its budget (a provider is down or slow). That is NOT the same as
// "no score", and treating it as one is what would turn the latency fix into a
// regression: a null is cached forever, so one unlucky batch during an outage
// would leave those cards permanently blank until a full reload.
//
// Deferred ids are retried with exponential backoff, then given up on. The cap
// is the point: a multi-hour provider outage must not become a client-side poll
// loop, so after the last attempt the id settles as "no score" (spinner stops,
// card looks like any other unscoreable one) and a reload asks again.
const RETRY_BASE_MS = 4_000;
const MAX_RETRIES = 3; // → retried at +4s, +12s, +28s, then settled

export interface PendingScore { score: number; center: number | null }

// id → resolved score, or null for "asked, and the answer is genuinely no
// score" (too little metadata even after healing, or a cold profile). A null
// is a FINAL state: it stops the spinner instead of retrying forever.
const resolved = new Map<string, PendingScore | null>();
const waiting = new Set<string>();
const listeners = new Map<string, Set<(v: PendingScore | null) => void>>();
// Deferred ids waiting out their backoff. Kept out of `resolved` (so they stay
// pending, not final) AND out of `waiting` (so they aren't re-sent immediately),
// which means `request()` has to consult this too or a re-mounting card would
// walk straight past the backoff.
const retrying = new Map<string, ReturnType<typeof setTimeout>>();
const attempts = new Map<string, number>();
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;

function emit(id: string, v: PendingScore | null) {
  for (const fn of listeners.get(id) ?? []) fn(v);
}

function settle(id: string, v: PendingScore | null) {
  resolved.set(id, v);
  emit(id, v);
}

function scheduleFlush() {
  if (!timer) timer = setTimeout(flush, DEBOUNCE_MS);
}

// "Ask again later." No emit: the card stays in its pending treatment, which is
// the honest rendering of "we're still trying".
function deferRetry(id: string) {
  const n = (attempts.get(id) ?? 0) + 1;
  attempts.set(id, n);
  if (n > MAX_RETRIES) { settle(id, null); return; }
  const delay = RETRY_BASE_MS * 2 ** (n - 1);
  retrying.set(id, setTimeout(() => {
    retrying.delete(id);
    waiting.add(id);
    scheduleFlush();
  }, delay));
}

async function flush() {
  timer = null;
  if (inFlight || waiting.size === 0) return;

  const batch = [...waiting].slice(0, MAX_PER_REQUEST);
  for (const id of batch) waiting.delete(id);
  inFlight = true;

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: batch }),
    });
    if (res.ok) {
      const data: {
        scores?: Record<string, PendingScore | null>;
        deferred?: string[];
        skipped?: string[];
      } = await res.json();
      // Both mean "we did not answer for this id" — over MAX_IDS, or out of
      // heal budget. Neither is an answer to cache.
      const askAgain = new Set([...(data.deferred ?? []), ...(data.skipped ?? [])]);
      for (const id of batch) {
        if (askAgain.has(id)) { deferRetry(id); continue; }
        settle(id, data.scores?.[id] ?? null);
      }
    } else if (res.status >= 500) {
      // Our own outage, not an answer — same treatment as deferred.
      for (const id of batch) deferRetry(id);
    } else {
      // 4xx (expired session, bad request): retrying won't change it. Don't
      // strand a spinner — settle as "no score".
      for (const id of batch) settle(id, null);
    }
  } catch {
    // Network failure — worth one more try, bounded by the same cap.
    for (const id of batch) deferRetry(id);
  } finally {
    inFlight = false;
    // Anything that arrived mid-flight (or came back in `skipped`) goes next.
    if (waiting.size > 0) scheduleFlush();
  }
}

function request(id: string) {
  if (resolved.has(id) || waiting.has(id) || retrying.has(id)) return;
  waiting.add(id);
  scheduleFlush();
}

/**
 * Subscribe to one id's score, requesting it if nobody has yet. Returns an
 * unsubscribe.
 *
 * Deliberately outside the hook: the batching + deferred-retry machinery is
 * where this module's contract lives, and keeping it callable without a
 * renderer is what lets it be tested directly (the suite runs in `node`, not
 * jsdom).
 */
export function subscribePendingScore(id: string, onResolved: (v: PendingScore | null) => void): () => void {
  let set = listeners.get(id);
  if (!set) { set = new Set(); listeners.set(id, set); }
  set.add(onResolved);
  request(id);
  return () => {
    set.delete(onResolved);
    if (set.size === 0) listeners.delete(id);
  };
}

/** Whether this id has a final answer cached. */
export function hasResolvedScore(id: string): boolean {
  return resolved.has(id);
}

/**
 * Resolve one pending card's score.
 *
 * `pending` false → inert (already scored server-side, anonymous viewer, or
 * cold start). Returns `{ score, loading }`: `loading` is true only while a
 * request for this id is genuinely outstanding.
 */
export function usePendingFandexScore(id: string | undefined, pending: boolean | undefined) {
  const active = !!pending && !!id;

  // The module cache is the single source of truth and is read during RENDER,
  // not mirrored into component state. That's deliberate: mirroring meant the
  // effect had to setState synchronously for the already-cached and inactive
  // cases, which is what `react-hooks/set-state-in-effect` (an error in this
  // repo) correctly objects to. Here the effect only subscribes; the one
  // setState is a re-render nudge fired from the fetch's async callback.
  const [, bump] = useState(0);
  const settled = !active || resolved.has(id!);
  const score = active ? resolved.get(id!) ?? null : null;

  useEffect(() => {
    if (!active || !id || settled) return;

    if (resolved.has(id)) {
      // Landed between this render and this effect. Nudge so the render above
      // re-reads the cache — via a microtask, so it isn't a synchronous
      // setState inside the effect body. Without this the spinner would stick
      // forever on exactly the cards that resolved fastest.
      queueMicrotask(() => bump((n) => n + 1));
      return;
    }

    return subscribePendingScore(id, () => bump((n) => n + 1));
  }, [id, active, settled]);

  return { score, loading: !settled };
}

// Tests only — module-level caches otherwise leak between cases.
export function __resetPendingScoreCache() {
  resolved.clear();
  waiting.clear();
  listeners.clear();
  attempts.clear();
  for (const t of retrying.values()) clearTimeout(t);
  retrying.clear();
  if (timer) { clearTimeout(timer); timer = null; }
  inFlight = false;
}
