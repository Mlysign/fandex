"use client";
import { useCallback, useEffect, useState } from "react";
import { ViewMode } from "@/components/SubBar";

const VALID: ViewMode[] = ["list", "card", "calendar"];

/**
 * Persists the selected view mode in localStorage so it survives navigation
 * and refreshes. SM2: keyed PER PAGE — Calendar on the wishlist shouldn't
 * flip Discover into calendar view too. (The old global "rr_view_mode" key is
 * simply abandoned; each page now owns e.g. "rr_view_wishlist".)
 *
 * Always renders with `fallback` on the first pass (server + client hydration),
 * then corrects to the stored value in a useEffect so server and client HTML
 * match and React doesn't throw a hydration mismatch.
 */
export function useViewMode(
  key: string,
  fallback: ViewMode = "list",
  allowed: ViewMode[] = ["list", "card", "calendar"]
): [ViewMode, (v: ViewMode) => void] {
  // Always start with the fallback — same value on server and client first render.
  const [view, setViewState] = useState<ViewMode>(fallback);

  // After hydration, read localStorage and correct if needed.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(key) as ViewMode | null;
      if (stored && VALID.includes(stored) && allowed.includes(stored)) {
        // localStorage is unavailable during SSR, so correcting to the stored
        // value necessarily happens here (see the hydration note above).
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setViewState(stored);
      }
    } catch { /* storage unavailable */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]); // run once per key

  const setView = useCallback((v: ViewMode) => {
    setViewState(v);
    try { localStorage.setItem(key, v); } catch { /* ignore */ }
  }, [key]);

  return [view, setView];
}
