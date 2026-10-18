// The list header gets out of the way while you scroll down and comes back the
// moment you scroll up, without having to go back to the top. The site's rule
// (src/lib/useHideOnScroll.ts there, Nils 2026-08-14): within 64 px of the top
// it always shows; a step of more than 8 px down hides it; more than 4 px up
// shows it.
//
// A screen holds the state (components/ui.tsx, Screen), its list takes its
// scroll handler and top inset from useBarList (components/cards.tsx,
// PosterGrid), and the bar reads it (SubBar.tsx). Phones only: on a wide
// window the bar costs nothing worth winning back.
//
// While a list is under it, the bar FLOATS over the list and slides; it never
// changes the list's layout. A bar that shrank the space above the list moved
// the list under a held thumb, which the list reads as a drag: hiding scrolled
// it back up by the bar's height, that showed the bar, showing scrolled it down
// again, and the bar flickered for as long as the thumb stayed down (2026-10-18).

import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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

interface BarScroll {
  hidden: boolean;
  /** The bar's height while it may hide, 0 where it stays put (a wide window). */
  height: number;
  /** A list is under the bar, so the bar floats over it. */
  floating: boolean;
  report: (y: number) => void;
  setHeight: (h: number) => void;
  /** A list says it is there and makes room for the bar; returns the release. */
  claim: () => () => void;
}

const Ctx = createContext<BarScroll | null>(null);

export function BarScrollProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(false);
  const [height, setHeight] = useState(0);
  const [lists, setLists] = useState(0);
  const anchor = useRef(0);
  const report = useCallback((y: number) => {
    const next = nextBarState(y, anchor.current);
    if (!next) return;
    anchor.current = next.anchor;
    setHidden((h) => (h === next.hidden ? h : next.hidden));
  }, []);
  const claim = useCallback(() => {
    setLists((n) => n + 1);
    return () => setLists((n) => n - 1);
  }, []);
  const floating = lists > 0 && height > 0;
  const value = useMemo(() => ({ hidden: floating && hidden, height, floating, report, setHeight, claim }), [hidden, height, floating, report, claim]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** For the bar: whether to float and whether to be out of the way, and where to say its height. Null outside a screen that tracks it. */
export function useBarFrame(): Pick<BarScroll, 'hidden' | 'floating' | 'setHeight'> | null {
  return useContext(Ctx);
}

/**
 * For a list under the bar: its onScroll, and the room to leave above its
 * first row for the bar floating there. A list must take both, so they come
 * together. `mounted` is false while the screen shows something else in the
 * list's place (a spinner), which the bar must not cover.
 */
export function useBarList(mounted = true): { onScroll: ((e: NativeSyntheticEvent<NativeScrollEvent>) => void) | undefined; inset: number } {
  const ctx = useContext(Ctx);
  const claim = ctx?.claim;
  // Before paint, so the bar leaves the flow and the list makes room in the same frame.
  useLayoutEffect(() => (mounted ? claim?.() : undefined), [claim, mounted]);
  const report = ctx?.report;
  const onScroll = useMemo(() => (report ? (e: NativeSyntheticEvent<NativeScrollEvent>) => report(e.nativeEvent.contentOffset.y) : undefined), [report]);
  return { onScroll, inset: ctx?.floating ? ctx.height : 0 };
}
