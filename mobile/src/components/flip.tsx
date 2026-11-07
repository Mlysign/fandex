// Cards that move when the list under them changes (a type filter tapped, a
// sort picked, a title taken off the wishlist), instead of the grid redrawing
// in a new order in one frame.
//
// Two steps. The cards that are about to go fade out where they are. Then the
// new list is drawn, and every card that was already there starts from where
// it used to be and slides to its new place, while the ones that are new fade
// in. Cards in a grid or a rail are drawn in rows of their own, so a card that
// moves up a row is a NEW view in another row: it cannot be "moved". Each card
// instead works out where it was from its old index and the list's geometry
// (`place`), and starts there. That is the FLIP trick (first, last, invert, play).
//
// App-only: the website's server render never reaches this (cardFace.tsx stays clean).

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Platform, type StyleProp, type ViewStyle } from 'react-native';
import { FEEL } from '~/lib/feel';

const NATIVE = Platform.OS !== 'web';
const EMPHASIZED = Easing.bezier(0.2, 0, 0, 1);
/** How long a card that is going takes to fade, before the rest move. */
const LEAVE_MS = 150;
/** A card mounted later than this after a change is one scrolled into view, and just appears. */
const FRESH_MS = 450;
/** A card that would have to travel further than this fades in instead: a fly-in from far off reads as a glitch. */
const MAX_TRAVEL = 900;

export interface Flip {
  /** Bumped with every animated change. */
  gen: number;
  /** When it was drawn; 0 for a change that should not animate (the first fill). */
  at: number;
  /** Where each card was before the change, by key. */
  prev: ReadonlyMap<string, number>;
  /** The cards fading out before the change is drawn. */
  leaving: ReadonlySet<string>;
}

const STILL: Flip = { gen: 0, at: 0, prev: new Map(), leaving: new Set() };

/**
 * Holds a list back while its leaving cards fade, then hands over the new one
 * with what each card needs to move. `source` is whatever the list is drawn
 * from (an array, or a grid's items and sections); `keysOf` lists its cards in order.
 * A change that only refreshes the same cards in the same order passes straight through.
 */
export function useFlip<S>(source: S, keysOf: (s: S) => string[]): { shown: S; flip: Flip } {
  const [state, setState] = useState<{ shown: S; flip: Flip }>({ shown: source, flip: STILL });
  const shownRef = useRef(state.shown);
  shownRef.current = state.shown;
  const keysRef = useRef(keysOf);
  keysRef.current = keysOf;

  useEffect(() => {
    const old = shownRef.current;
    if (source === old) return;
    const keys = keysRef.current;
    const oldKeys = keys(old);
    const newKeys = keys(source);
    if (oldKeys.length === newKeys.length && oldKeys.every((k, i) => k === newKeys[i])) {
      setState((s) => ({ shown: source, flip: s.flip }));
      return;
    }
    const commit = (animate: boolean) => setState((s) => ({
      shown: source,
      flip: { gen: s.flip.gen + 1, at: animate ? Date.now() : 0, prev: new Map(oldKeys.map((k, i) => [k, i])), leaving: new Set() },
    }));
    // The first fill, or an emptied list, just appears.
    if (!oldKeys.length || !newKeys.length) { commit(false); return; }
    const keep = new Set(newKeys);
    const going = oldKeys.filter((k) => !keep.has(k));
    if (!going.length) { commit(true); return; }
    setState((s) => ({ shown: s.shown, flip: { ...s.flip, leaving: new Set(going) } }));
    const t = setTimeout(() => commit(true), LEAVE_MS);
    return () => clearTimeout(t);
  }, [source]);

  return state;
}

/**
 * One card of a list `useFlip` holds. `place` turns an index into where that
 * index sits in the list, in the list's own pixels; null when it cannot be
 * worked out (a grid cut by month dividers), and the card then fades in.
 */
export function FlipCell({ id, index, flip, place, style, children }: {
  id: string;
  index: number;
  flip: Flip;
  place: (index: number) => { x: number; y: number } | null;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const shift = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const fade = useRef(new Animated.Value(1)).current;
  const grow = useRef(new Animated.Value(1)).current;
  const leaving = flip.leaving.has(id);

  // On every change, and on a mount that came with one: start from where the card was.
  const gen = flip.gen;
  useLayoutEffect(() => {
    if (!flip.at || Date.now() - flip.at > FRESH_MS) return;
    const from = flip.prev.get(id);
    if (from === index) return;
    const a = from != null ? place(from) : null;
    const b = place(index);
    if (a && b && Math.hypot(a.x - b.x, a.y - b.y) < MAX_TRAVEL) {
      shift.setValue({ x: a.x - b.x, y: a.y - b.y });
      Animated.timing(shift, { toValue: { x: 0, y: 0 }, duration: FEEL.layoutMs + 60, easing: EMPHASIZED, useNativeDriver: NATIVE }).start();
      return;
    }
    fade.setValue(0);
    grow.setValue(0.92);
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: FEEL.layoutMs, easing: EMPHASIZED, useNativeDriver: NATIVE }),
      Animated.timing(grow, { toValue: 1, duration: FEEL.layoutMs, easing: EMPHASIZED, useNativeDriver: NATIVE }),
    ]).start();
    // Only a new change moves the card; `place` and `index` are read as they are at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gen]);

  useEffect(() => {
    if (!leaving) return;
    Animated.parallel([
      Animated.timing(fade, { toValue: 0, duration: LEAVE_MS, easing: Easing.out(Easing.quad), useNativeDriver: NATIVE }),
      Animated.timing(grow, { toValue: 0.9, duration: LEAVE_MS, easing: Easing.out(Easing.quad), useNativeDriver: NATIVE }),
    ]).start();
  }, [leaving, fade, grow]);

  return (
    <Animated.View style={[style, { opacity: fade, transform: [{ translateX: shift.x }, { translateY: shift.y }, { scale: grow }] }]}>
      {children}
    </Animated.View>
  );
}
