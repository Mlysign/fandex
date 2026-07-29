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

export interface PendingScore { score: number; center: number | null }

// id → resolved score, or null for "asked, and the answer is genuinely no
// score" (too little metadata even after healing, or a cold profile). A null
// is a FINAL state: it stops the spinner instead of retrying forever.
const resolved = new Map<string, PendingScore | null>();
const waiting = new Set<string>();
const listeners = new Map<string, Set<(v: PendingScore | null) => void>>();
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;

function emit(id: string, v: PendingScore | null) {
  for (const fn of listeners.get(id) ?? []) fn(v);
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
      const data: { scores?: Record<string, PendingScore | null> } = await res.json();
      for (const id of batch) {
        const v = data.scores?.[id] ?? null;
        resolved.set(id, v);
        emit(id, v);
      }
    } else {
      // Don't strand a spinner on a failed request — settle as "no score".
      for (const id of batch) { resolved.set(id, null); emit(id, null); }
    }
  } catch {
    for (const id of batch) { resolved.set(id, null); emit(id, null); }
  } finally {
    inFlight = false;
    // Anything that arrived mid-flight (or came back in `skipped`) goes next.
    if (waiting.size > 0 && !timer) timer = setTimeout(flush, DEBOUNCE_MS);
  }
}

function request(id: string) {
  if (resolved.has(id) || waiting.has(id)) return;
  waiting.add(id);
  if (!timer) timer = setTimeout(flush, DEBOUNCE_MS);
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

    const onResolved = () => bump((n) => n + 1);
    let set = listeners.get(id);
    if (!set) { set = new Set(); listeners.set(id, set); }
    set.add(onResolved);
    request(id);

    return () => {
      set.delete(onResolved);
      if (set.size === 0) listeners.delete(id);
    };
  }, [id, active, settled]);

  return { score, loading: !settled };
}

// Tests only — module-level caches otherwise leak between cases.
export function __resetPendingScoreCache() {
  resolved.clear();
  waiting.clear();
  listeners.clear();
  if (timer) { clearTimeout(timer); timer = null; }
  inFlight = false;
}
