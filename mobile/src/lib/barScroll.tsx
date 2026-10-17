// The list header gets out of the way while you scroll down and comes back the
// moment you scroll up, without having to go back to the top. The site's rule
// (src/lib/useHideOnScroll.ts there, Nils 2026-08-14): within 64 px of the top
// it always shows; a step of more than 8 px down hides it; more than 4 px up
// shows it.
//
// A screen holds the state (components/ui.tsx, Screen), its list reports where
// it is (components/cards.tsx, PosterGrid), and the bar reads it (SubBar.tsx).
// Phones only: on a wide window the bar costs nothing worth winning back.

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

const OFFSET = 64;
const UP_EPS = 4;
const DOWN_EPS = 8;

/** The rule, on its own so it has a test. Returns the new anchor and whether the bar is hidden, or null for no change. */
export function nextBarState(y: number, anchor: number): { anchor: number; hidden: boolean } | null {
  if (y <= OFFSET) return { anchor: y, hidden: false };
  const delta = y - anchor;
  if (delta < -UP_EPS) return { anchor: y, hidden: false };
  if (delta > DOWN_EPS) return { anchor: y, hidden: true };
  return null;
}

const Ctx = createContext<{ hidden: boolean; report: (y: number) => void } | null>(null);

export function BarScrollProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(false);
  const anchor = useRef(0);
  const report = useCallback((y: number) => {
    const next = nextBarState(y, anchor.current);
    if (!next) return;
    anchor.current = next.anchor;
    setHidden((h) => (h === next.hidden ? h : next.hidden));
  }, []);
  const value = useMemo(() => ({ hidden, report }), [hidden, report]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Whether the list header should be out of the way. False outside a screen that tracks it. */
export function useBarHidden(): boolean {
  return useContext(Ctx)?.hidden ?? false;
}

/** A list's onScroll, for the bar to follow. Undefined outside a screen that tracks it. */
export function useReportScroll(): ((e: NativeSyntheticEvent<NativeScrollEvent>) => void) | undefined {
  const report = useContext(Ctx)?.report;
  return useMemo(() => (report ? (e: NativeSyntheticEvent<NativeScrollEvent>) => report(e.nativeEvent.contentOffset.y) : undefined), [report]);
}
