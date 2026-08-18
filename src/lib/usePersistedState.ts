"use client";
import { useEffect, useRef, useState } from "react";

// State that survives client-side navigation (e.g. opening an item then going
// back) by mirroring to sessionStorage. First paint uses `initial`; the stored
// value is restored on mount. Used for the list pages' filters/search/sort so
// back-nav doesn't reset them (T12).
export function usePersistedState<T>(key: string, initial: T, normalize?: (v: T) => T): [T, (v: T | ((p: T) => T)) => void] {
  const [val, setVal] = useState<T>(initial);
  // `hydrated` is state, not a ref, so the save effect below skips the very first
  // commit: a ref would flip true synchronously inside the hydrate effect and the
  // save effect (same commit) would then clobber storage with the stale `initial`
  // before the restored value commits — which under React's dev double-invoke of
  // effects gets read back as the value, losing the persisted state on back-nav.
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(key);
      // Hydrating from sessionStorage must happen post-mount (it's unavailable
      // during SSR), so this restore necessarily sets state in an effect.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw != null) { const parsed = JSON.parse(raw) as T; setVal(normalize ? normalize(parsed) : parsed); }
    } catch { /* storage unavailable / bad JSON */ }
    setHydrated(true);
    // `normalize` must be a STABLE reference (module-level fn) — an inline arrow
    // would re-run this hydrate effect every render and clobber user edits.
  }, [key, normalize]);

  useEffect(() => {
    if (!hydrated) return;
    try { sessionStorage.setItem(key, JSON.stringify(val)); } catch { /* quota */ }
  }, [key, val, hydrated]);

  return [val, setVal];
}

// Whether a page has a meaningful saved scroll position to restore (N2): lets
// list pages suppress their auto-scroll-to-today, which would otherwise fight
// the restore and dump the viewer back at "today" on every Back. False during
// SSR (no sessionStorage), which is fine — the consumers gate client effects.
export function hasSavedScroll(key: string): boolean {
  try { return (parseInt(sessionStorage.getItem(key) ?? "0", 10) || 0) > 4; } catch { return false; }
}

// Save + restore window scroll for a page across back-nav. Restores once after
// `ready` becomes true (i.e. the list has rendered), then tracks scroll to save.
export function useScrollRestore(key: string, ready: boolean) {
  const restored = useRef(false);
  useEffect(() => {
    if (!ready) return;
    let raf = 0;
    let userScrolled = false;
    const markUser = () => { userScrolled = true; };
    // Pathname pin (N2): navigating away fires one last scroll event — the
    // router's scroll-to-top — while this listener is still attached, which
    // saved `0` over the real position and made every restore a no-op (Back
    // then landed on the today-scroll instead). Only pathname, not search:
    // in-page query updates (e.g. the facet ?sort=) must keep saving.
    const path = window.location.pathname;
    const onScroll = () => {
      if (window.location.pathname !== path) return;
      try { sessionStorage.setItem(key, String(window.scrollY)); } catch { /* ignore */ }
    };

    // Restore once, but (re)attach the scroll listener every time the effect runs.
    // Gating the listener behind the one-time `restored` ref would drop it on
    // React's dev effect re-invoke, so the scroll position would stop being saved.
    if (!restored.current) {
      restored.current = true;
      try {
        const raw = sessionStorage.getItem(key);
        const target = raw != null ? parseInt(raw, 10) || 0 : 0;
        if (target > 4) {
          // Apply SYNCHRONOUSLY here, not only via the rAF loop below: on a
          // client-side back-navigation this effect can run against a
          // component instance that gets torn down again almost immediately
          // (Next's router-cache/traverse handling remounts the segment more
          // than once in quick succession). A `requestAnimationFrame(tick)`
          // scheduled from the FIRST of those mounts routinely got cancelled
          // by that mount's own cleanup before the browser ever ran it — so
          // the one-shot `restored` budget was spent scheduling a callback
          // that never fired, and the page silently fell back to whatever the
          // browser's native (Next.js doesn't manage `history.scrollRestoration`)
          // or Next's own scroll-into-view handling left it at. A direct call
          // here doesn't depend on a future frame surviving, so at least one
          // real attempt lands on every mount, no matter how many times this
          // effect gets torn down and re-run for the same navigation.
          window.scrollTo(0, target);
          // Re-apply across a short window rather than once: filters persisted via
          // usePersistedState hydrate a beat after the list first renders, so a
          // single scrollTo would land against the un-filtered (taller) list and
          // then collapse when a narrow facet shrinks it. Keep nudging to the
          // target until it sticks or the user takes over.
          const start = performance.now();
          const tick = () => {
            if (userScrolled) return;
            window.scrollTo(0, target);
            if (Math.abs(window.scrollY - target) > 2 && performance.now() - start < 1200) {
              raf = requestAnimationFrame(tick);
            }
          };
          window.addEventListener("wheel", markUser, { passive: true });
          window.addEventListener("touchmove", markUser, { passive: true });
          window.addEventListener("keydown", markUser);
          raf = requestAnimationFrame(tick);
        }
      } catch { /* ignore */ }
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("wheel", markUser);
      window.removeEventListener("touchmove", markUser);
      window.removeEventListener("keydown", markUser);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [key, ready]);
}

// Write a value into the store a `usePersistedState(key, …)` will hydrate from,
// BEFORE the component that owns it mounts (2026-08-18). One use so far: the nav
// search box's Enter fallback hands its query to /discover, whose query lives in
// `rr_discover_q` rather than in the URL.
//
// It exists so the JSON encoding stays in exactly one place — a caller writing
// `sessionStorage.setItem(key, term)` (no JSON.stringify) would store a value the
// hydrate above throws on and silently discards.
export function seedPersistedState<T>(key: string, value: T): void {
  try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable / quota */ }
}
