// The ten stars and the Save pop: the two taps that should feel good. Every
// number is in lib/feel.ts, with the Bubblewrap lessons behind them.
//
// The stars are ONE touch target the width of the row, not ten small buttons.
// Touch down lights the star under the finger and ticks; sliding moves it
// star by star, one tick each; letting go rates. The finger hides the star it
// is on, so the number is read out above the row. Letting go well above or
// below the row picks nothing. There are no gaps: every point of the row is a
// star, so a tap between two lands on the nearer one instead of on nothing.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import { FEEL, haptics, ratingTier } from '~/lib/feel';
import { color, type } from '~/theme';

const NATIVE = Platform.OS !== 'web';
const ROW_HEIGHT = 52;
/** How far above or below the row a release still counts. Further, and it picks nothing. */
const RELEASE_SLOP = 40;

/** A rating's colour: green from 7, amber from 5, red under (QuickActions.tsx). */
export const ratingColor = (r: number) => (r >= 7 ? color.success : r >= 5 ? color.warning : color.danger);

interface Spark { dx: number; dy: number; size: number; spin: number; gold: boolean }

function makeSparks(count: number, reach: number, top: boolean): Spark[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
    const d = reach * (0.65 + Math.random() * 0.6) * (top ? 1.35 : 1);
    return { dx: Math.cos(angle) * d, dy: Math.sin(angle) * d, size: 8 + Math.random() * 6, spin: (Math.random() - 0.5) * 360, gold: top && i % 2 === 0 };
  });
}

/**
 * Ten stars. The one that is already your rating takes the rating away.
 * `onPick` runs the moment the finger lifts; `onSettled` once the pop has
 * played, which is when a picker should close.
 */
export function StarPicker({ rating, onPick, onSettled }: {
  rating: number | null;
  onPick: (n: number | null) => void;
  onSettled?: () => void;
}) {
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);
  /** What was picked, once the finger lifted: null for a rating taken away. */
  const [picked, setPicked] = useState<number | null | undefined>(undefined);
  const locked = useRef(false);
  const [width, setWidth] = useState(0);

  const scales = useRef(Array.from({ length: 10 }, () => new Animated.Value(1))).current;
  const readout = useRef(new Animated.Value(1)).current;
  const ring = useRef(new Animated.Value(0)).current;
  const burst = useRef(new Animated.Value(0)).current;
  const [fx, setFx] = useState<{ at: number; sparks: Spark[]; tint: string } | null>(null);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const current = rating != null ? Math.round(rating) : 0;
  const shown = active || (picked !== undefined ? picked ?? 0 : current);
  const cell = width / 10;

  const starAt = (x: number, rowWidth?: number) => {
    const c = cell || (rowWidth ?? 0) / 10;
    return c > 0 ? Math.max(1, Math.min(10, Math.floor(x / c) + 1)) : 0;
  };

  /** The finger is on star `n` now (0: on none). The old one settles, the new one lifts. */
  const move = (n: number, tick: boolean) => {
    const was = activeRef.current;
    if (n === was) return;
    activeRef.current = n;
    setActive(n);
    if (was) Animated.timing(scales[was - 1], { toValue: 1, duration: FEEL.holdMs, useNativeDriver: NATIVE }).start();
    if (!n) return;
    Animated.timing(scales[n - 1], { toValue: FEEL.holdScale, duration: FEEL.holdMs, easing: Easing.out(Easing.quad), useNativeDriver: NATIVE }).start();
    readout.setValue(FEEL.readoutSwell);
    Animated.spring(readout, { toValue: 1, friction: 5, tension: 220, useNativeDriver: NATIVE }).start();
    if (tick) haptics.detent();
  };

  const commit = (n: number) => {
    if (locked.current || !n) return;
    locked.current = true;
    const value = n === current && rating != null ? null : n;
    const tier = ratingTier(value);
    haptics.rate(value);
    activeRef.current = 0;
    setActive(0);
    setPicked(value);
    onPick(value);

    const star = scales[n - 1];
    if (value == null) {
      // Taken away: the star caves in and the row goes dark.
      Animated.sequence([
        Animated.timing(star, { toValue: 0.6, duration: 120, useNativeDriver: NATIVE }),
        Animated.spring(star, { toValue: 1, friction: 6, tension: 140, useNativeDriver: NATIVE }),
      ]).start();
    } else {
      Animated.sequence([
        Animated.timing(star, { toValue: FEEL.popScale, duration: FEEL.popUpMs, easing: Easing.out(Easing.back(2)), useNativeDriver: NATIVE }),
        Animated.spring(star, { toValue: 1, friction: 3.5, tension: 120, useNativeDriver: NATIVE }),
      ]).start();
      // A wave along the lit stars toward the one picked, so a high number lands as a cascade.
      if (tier === 'high' || tier === 'top') {
        const upTo = tier === 'top' ? 10 : n;
        for (let i = 0; i < upTo; i++) {
          if (i === n - 1) continue;
          Animated.sequence([
            Animated.delay(i * FEEL.waveStaggerMs),
            Animated.timing(scales[i], { toValue: FEEL.waveScale, duration: 90, easing: Easing.out(Easing.quad), useNativeDriver: NATIVE }),
            Animated.spring(scales[i], { toValue: 1, friction: 4, tension: 140, useNativeDriver: NATIVE }),
          ]).start();
        }
      }
      setFx({ at: n, sparks: makeSparks(FEEL.sparks[tier as 'low' | 'mid' | 'high' | 'top'], FEEL.sparkReach, tier === 'top'), tint: ratingColor(value) });
      ring.setValue(0);
      burst.setValue(0);
      Animated.timing(ring, { toValue: 1, duration: FEEL.ringMs, easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE }).start();
      Animated.timing(burst, { toValue: 1, duration: FEEL.sparkMs, easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE }).start();
    }
    readout.setValue(value == null ? 0.8 : FEEL.readoutSwell * 1.15);
    Animated.spring(readout, { toValue: 1, friction: 4, tension: 160, useNativeDriver: NATIVE }).start();
    timer.current = setTimeout(() => onSettled?.(), FEEL.settleMs[tier]);
  };

  const rowRef = useRef<View>(null);
  /**
   * Where the touch is, from the row's left and top edge. On a phone the row is
   * the touch's target (the stars take no touches), so `locationX` is that.
   * In a browser `locationX` can be measured from whatever element sits under
   * the pointer, so it is worked out from the row's own rectangle instead.
   */
  const where = (e: { nativeEvent: { locationX?: number; locationY?: number; clientX?: number; clientY?: number; pageX?: number; pageY?: number } }) => {
    const ev = e.nativeEvent;
    if (Platform.OS !== 'web') return { x: ev.locationX ?? 0, y: ev.locationY ?? 0, w: undefined };
    const rect = (rowRef.current as unknown as HTMLElement | null)?.getBoundingClientRect();
    const cx = ev.clientX ?? (ev.pageX ?? 0) - window.scrollX;
    const cy = ev.clientY ?? (ev.pageY ?? 0) - window.scrollY;
    // A browser reports the row's size a moment after it opens; a tap before that still lands.
    if (rect && !width) setWidth(rect.width);
    return { x: cx - (rect?.left ?? 0), y: cy - (rect?.top ?? 0), w: rect?.width };
  };

  const onGrant = (e: GestureResponderEvent) => {
    if (locked.current) return true;
    const { x, w } = where(e);
    move(starAt(x, w), true);
    // True: Android's scroll view may not take the touch over while a finger is on the stars.
    return true;
  };
  const onMove = (e: GestureResponderEvent) => {
    if (locked.current) return;
    const { x, y, w } = where(e);
    const off = y < -RELEASE_SLOP || y > ROW_HEIGHT + RELEASE_SLOP;
    move(off ? 0 : starAt(x, w), true);
  };
  const onRelease = () => {
    if (locked.current) return;
    commit(activeRef.current);
  };
  const onCancel = () => { if (!locked.current) move(0, false); };

  // A mouse lights the stars before it clicks, as the site's did.
  const hover = Platform.OS === 'web' ? ({
    onMouseMove: (e: { nativeEvent: { clientX: number; clientY: number } }) => {
      if (locked.current) return;
      const { x, w } = where(e);
      move(starAt(x, w), false);
    },
    onMouseLeave: () => { if (!locked.current) move(0, false); },
  } as object) : null;

  const removing = active > 0 && active === current && rating != null;
  const hint = picked !== undefined ? (picked == null ? 'Rating removed' : '')
    : removing ? 'Let go to remove'
    : active ? ''
    : rating != null ? 'Your rating' : 'Tap or slide';

  return (
    <View style={styles.wrap}>
      <View style={styles.readout}>
        <Animated.View style={[styles.readoutNumber, { transform: [{ scale: readout }] }]}>
          {shown ? (
            <>
              <Text style={[type.serifLg, { color: ratingColor(shown) }]}>{shown}</Text>
              <Text style={[type.caption, { marginLeft: 2 }]}>/10</Text>
            </>
          ) : null}
        </Animated.View>
        <Text style={[type.caption, removing && { color: color.danger }]}>{hint}</Text>
      </View>

      <View
        ref={rowRef}
        style={styles.row}
        onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={onGrant}
        onResponderMove={onMove}
        onResponderRelease={onRelease}
        onResponderTerminate={onCancel}
        {...hover}>
        {fx && cell > 0 ? <Burst cell={cell} fx={fx} ring={ring} burst={burst} /> : null}
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
          const lit = shown >= n;
          return (
            // Not a touch target itself (the row is): only a screen reader presses it, by name.
            <View
              key={n}
              pointerEvents="none"
              accessible
              accessibilityRole="button"
              accessibilityLabel={n === current && rating != null ? 'Remove your rating' : `Rate ${n} out of 10`}
              accessibilityActions={[{ name: 'activate' }]}
              onAccessibilityAction={() => commit(n)}
              style={styles.cell}>
              <Animated.Text style={[styles.star, { color: lit ? ratingColor(shown) : color.neutral600, transform: [{ scale: scales[n - 1] }] }]}>★</Animated.Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

/** The ring and the sparks thrown from the picked star. Never takes a touch. */
function Burst({ cell, fx, ring, burst }: { cell: number; fx: { at: number; sparks: Spark[]; tint: string }; ring: Animated.Value; burst: Animated.Value }) {
  const cx = (fx.at - 0.5) * cell;
  const cy = ROW_HEIGHT / 2;
  const ringSize = Math.min(cell, ROW_HEIGHT) * 0.95;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View
        style={[styles.ring, {
          left: cx - ringSize / 2, top: cy - ringSize / 2, width: ringSize, height: ringSize, borderRadius: ringSize / 2, borderColor: fx.tint,
          opacity: ring.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.9, 0] }),
          transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [FEEL.ringFrom, FEEL.ringTo] }) }],
        }]}
      />
      {fx.sparks.map((s, i) => (
        <Animated.Text
          key={i}
          style={[styles.spark, {
            left: cx - s.size / 2, top: cy - s.size / 2, fontSize: s.size, lineHeight: s.size + 2,
            color: s.gold ? color.accent : fx.tint,
            opacity: burst.interpolate({ inputRange: [0, 0.1, 0.65, 1], outputRange: [0, 1, 1, 0] }),
            transform: [
              { translateX: burst.interpolate({ inputRange: [0, 1], outputRange: [0, s.dx] }) },
              // A little fall at the end, so they read as thrown rather than slid.
              { translateY: burst.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0, s.dy * 0.9, s.dy + 10] }) },
              { scale: burst.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0.3, 1.25, 0.5] }) },
              { rotate: burst.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${s.spin}deg`] }) },
            ],
          }]}>
          ★
        </Animated.Text>
      ))}
    </View>
  );
}

// ── Saving ───────────────────────────────────────────────────────────────────

/**
 * Three small dots that breathe one after another: something you did is
 * already shown as done and is still on its way to Trakt. Quiet on purpose,
 * it sits under a title and never in place of the thing you tapped.
 */
export function SavingDots() {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(t, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: NATIVE }));
    loop.start();
    return () => loop.stop();
  }, [t]);
  return (
    <View accessible accessibilityLabel="Saving" style={styles.dots}>
      {[0, 1, 2].map((i) => (
        <Animated.View
          key={i}
          style={[styles.dot, {
            opacity: t.interpolate({ inputRange: [0, 0.1 + i * 0.2, 0.2 + i * 0.2, 0.3 + i * 0.2, 1], outputRange: [0.25, 0.25, 1, 0.25, 0.25] }),
          }]}
        />
      ))}
    </View>
  );
}

// ── Save ─────────────────────────────────────────────────────────────────────

/**
 * Save's feel, quieter than a rating on purpose: the icon dips under the
 * finger, and turning it on pops it with a faint ring and a small click.
 * Turning it off is one soft tick and no show.
 */
export function useSavePop() {
  const scale = useRef(new Animated.Value(1)).current;
  const ring = useRef(new Animated.Value(1)).current;
  return {
    scale,
    ring,
    pressIn: () => Animated.timing(scale, { toValue: FEEL.savePress, duration: FEEL.holdMs, easing: Easing.out(Easing.quad), useNativeDriver: NATIVE }).start(),
    pressOut: () => Animated.spring(scale, { toValue: 1, friction: 5, tension: 180, useNativeDriver: NATIVE }).start(),
    fire: (on: boolean) => {
      haptics.save(on);
      if (!on) return;
      Animated.sequence([
        Animated.timing(scale, { toValue: FEEL.savePop, duration: 100, easing: Easing.out(Easing.quad), useNativeDriver: NATIVE }),
        Animated.spring(scale, { toValue: 1, friction: 3.5, tension: 160, useNativeDriver: NATIVE }),
      ]).start();
      ring.setValue(0);
      Animated.timing(ring, { toValue: 1, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE }).start();
    },
  };
}

/** The icon `useSavePop` moves, with its ring behind it. */
export function SavePopGlyph({ pop, size = 14, children }: { pop: ReturnType<typeof useSavePop>; size?: number; children: ReactNode }) {
  const ringSize = size * 1.6;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute', width: ringSize, height: ringSize, borderRadius: ringSize / 2, borderWidth: 1.5, borderColor: color.accent,
          opacity: pop.ring.interpolate({ inputRange: [0, 0.1, 1], outputRange: [0, 0.7, 0] }),
          transform: [{ scale: pop.ring.interpolate({ inputRange: [0, 1], outputRange: [0.6, 2] }) }],
        }}
      />
      <Animated.View style={{ transform: [{ scale: pop.scale }] }}>{children}</Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 8, paddingTop: 6, paddingBottom: 4 },
  readout: { height: 30, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 6 },
  readoutNumber: { flexDirection: 'row', alignItems: 'baseline' },
  // No text selection: in a browser a drag across the stars selected them as text.
  row: { height: ROW_HEIGHT, flexDirection: 'row', userSelect: 'none' },
  cell: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // The system font: the app's own fonts have no ★.
  star: { fontSize: 27, lineHeight: 31 },
  ring: { position: 'absolute', borderWidth: 2 },
  spark: { position: 'absolute', textAlign: 'center' },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  dot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: color.textSecondary },
});
