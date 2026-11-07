// The header every list screen shares: the type filter, the tabs, a search
// field, and a line with the count on the left and the sort on the right.
// Ports of src/components/SubBar.tsx, ui/TypeFilter.tsx, ui/CollapsibleChips.tsx
// and LibraryWishlistTabs.tsx.
//
// The Filters sheet is components/Filters.tsx. Hiding the bar while a list
// scrolls down is lib/barScroll.tsx.

import { ChevronLeft, Clapperboard, Tv } from 'lucide-react-native';
import type { Gamepad2 } from 'lucide-react-native';
import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Reanimated, { Easing as REasing, LinearTransition } from 'react-native-reanimated';
import { MEDIA_TYPES } from '@/lib/mediaTypes';
import { SearchBar, SortMenu } from '~/components/kit';
import { LogoOutline } from '~/components/Logo';
import { PRESS, usePressScale } from '~/components/pressFeel';
import { haptics } from '~/lib/feel';
import { useTypeFilter } from '~/lib/typeFilter';
import { useOfferedTypes } from '~/lib/features';
import { TYPE_ICONS as SHARED_TYPE_ICONS } from '~/lib/typeIcons';
import { useOutsideClose } from '~/lib/useOutsideClose';
import { useBarFrame } from '~/lib/barScroll';
import { breakpoint, color, radius, type, TYPE_PLURAL } from '~/theme';

const TYPE_ICONS: Record<string, typeof Gamepad2> = SHARED_TYPE_ICONS;

// ── The type filter ──────────────────────────────────────────────────────────

const NATIVE = Platform.OS !== 'web';
const EMPHASIZED = Easing.bezier(0.2, 0, 0, 1);
const OPEN_MS = 340;
const CLOSE_MS = 200;
/** A neighbour on the bar's row (the calendar's sources) slides when the type row opens or folds. */
const ROW_MOVE = LinearTransition.duration(OPEN_MS).easing(REasing.bezier(0.2, 0, 0, 1));

/** A type chip: it sinks under the finger, and a tap pops it with a click, so a filter change lands. */
function Circle({ active, fill, label, hint, onPress, onLongPress, children, count }: {
  active: boolean; fill?: string; label: string; hint?: string; onPress: () => void; onLongPress?: () => void; children: ReactNode; count?: number;
}) {
  const press = usePressScale(PRESS.chip);
  return (
    <Pressable
      onPress={() => { press.pop(); haptics.chip(); onPress(); }}
      onLongPress={onLongPress ? () => { press.pop(); haptics.soft(); onLongPress(); } : undefined}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      accessibilityHint={hint}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      // A browser has no "selected" for a button; pressed is what a toggle is there.
      {...(Platform.OS === 'web' ? ({ 'aria-pressed': active } as object) : null)}
      accessibilityLabel={label}
      hitSlop={2}>
      <Animated.View style={[styles.circle, active && fill ? { backgroundColor: fill, borderColor: fill } : null, { transform: [{ scale: press.scale }] }]}>
        {children}
        {count ? <View style={styles.count}><Text style={styles.countText}>{count}</Text></View> : null}
      </Animated.View>
    </Pressable>
  );
}

/**
 * Chip `i` of `n` as the row opens: it starts on top of the folded circle and
 * fans out to its place, growing and fading up, a little after the one before.
 * `t` runs 0 (folded) to 1 (open).
 */
function fanOut(t: Animated.Value, i: number, n: number) {
  const lag = 0.4 / Math.max(1, n - 1);
  const p = t.interpolate({ inputRange: [i * lag, i * lag + 0.6], outputRange: [0, 1], extrapolate: 'clamp' });
  return {
    opacity: p,
    transform: [
      { translateX: p.interpolate({ inputRange: [0, 1], outputRange: [-i * 48, 0] }) },
      { scale: p.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) },
    ],
  };
}

// ── Room for the chip groups ─────────────────────────────────────────────────
//
// A chip group (the types here, the calendar's sources) folds into one circle
// so a phone's bar stays one row (SM53). On a wider screen it stays open
// whenever every group fits on the row together (Nils, 2026-10-17: "uncollapse
// if enough space on desktop"). It used to be a fixed 1024 px, which folded
// everything in a 900 px browser window with half the bar empty.
//
// The bar measures its row; each group says how wide it is open. Phones stay
// folded whatever the room, as SM53 agreed.

const ChipRoom = createContext<{ width: number; claim: (id: string, px: number) => () => void; claimed: number } | null>(null);

/** Width of an open group of `n` 40 px circles with 8 px between them. */
export const circlesWidth = (n: number) => n * 40 + (n - 1) * 8;

/** Whether this group may stay open. `px` is its width when open. */
export function useChipRoom(px: number): boolean {
  const room = useContext(ChipRoom);
  const { width: windowWidth } = useWindowDimensions();
  const id = useId();
  const claim = room?.claim;
  useEffect(() => claim?.(id, px), [claim, id, px]);
  if (windowWidth < breakpoint.md) return false;
  if (!room) return windowWidth >= breakpoint.lg;
  // Measured, and every group's claim in: open only if they all fit.
  return room.width > 0 && room.claimed > 0 && room.claimed <= room.width;
}

/**
 * Icon circles, one per media type, and one for all of them. On a phone, or
 * where the bar has no room, they fold into a single circle that says what is
 * picked, and open on a tap.
 */
export function TypeFilter() {
  const f = useTypeFilter();
  // Board games only once the API has them (lib/features.ts).
  const offered = useOfferedTypes();
  const roomy = useChipRoom(circlesWidth(offered.length + 1));
  const [open, setOpen] = useState(false);
  const group = useRef<View>(null);
  // 0 folded, 1 open. A row that has room is open from the start and never moves.
  const t = useRef(new Animated.Value(roomy ? 1 : 0)).current;
  const unfold = () => {
    haptics.tap();
    t.setValue(0);
    setOpen(true);
    Animated.timing(t, { toValue: 1, duration: OPEN_MS, easing: EMPHASIZED, useNativeDriver: NATIVE }).start();
  };
  const fold = useCallback(() => {
    Animated.timing(t, { toValue: 0, duration: CLOSE_MS, easing: Easing.in(Easing.cubic), useNativeDriver: NATIVE })
      .start(({ finished }) => { if (finished) setOpen(false); });
  }, [t]);
  useOutsideClose(open, fold, group);
  useEffect(() => { if (roomy) t.setValue(1); }, [roomy, t]);
  const folding = usePressScale(PRESS.chip);

  const shown = new Set<string>(f.shown);
  // "Your types": no pick, so what Settings turned on is showing. The logo
  // circle is lit then, and the folded circle reads as unfiltered.
  const allActive = f.atDefault;
  const everyType = offered.every((t) => shown.has(t));
  const selected = offered.filter((t) => shown.has(t));

  if (!open && !roomy) {
    const Only = !allActive && selected.length === 1 ? TYPE_ICONS[selected[0]] : null;
    return (
      <Pressable
        onPress={unfold}
        onPressIn={folding.onPressIn}
        onPressOut={folding.onPressOut}
        accessibilityRole="button"
        accessibilityState={{ expanded: false }}
        accessibilityLabel={allActive ? 'Filter by type' : `Filter by type (${selected.length} selected)`}
        hitSlop={2}>
        <Animated.View style={[styles.circle, !allActive && { borderColor: color.accent }, { transform: [{ scale: folding.scale }] }]}>
          {Only ? <Only size={16} color={color.media[selected[0]]} /> : <LogoOutline tint={allActive ? color.textSecondary : color.accent} />}
          {!allActive && selected.length > 1 ? <View style={styles.count}><Text style={styles.countText}>{selected.length}</Text></View> : null}
        </Animated.View>
      </Pressable>
    );
  }

  // One tap narrows a full row to that type; from a partial row a tap adds or
  // drops; a long press hides one type (lib/typeFilter.tsx, `tapType`). The
  // logo circle goes back to your types (Settings' default, not every type:
  // Nils, 2026-11-07) and, on a folded bar, closes the row: it used to only
  // select, so the row could not be put away (Nils, 2026-10-18).
  const folded = !roomy;
  const n = offered.length + (folded ? 2 : 1);
  return (
    <View ref={group} style={styles.circles} accessibilityLabel="Filter by type">
      <Animated.View style={fanOut(t, 0, n)}>
        <Circle active={allActive} fill={color.accent} label="Your types" hint={folded ? 'Shows the types from your settings and closes the row' : 'Shows the types from your settings'}
          onPress={() => { f.reset(); if (folded) fold(); }}>
          <LogoOutline tint={allActive ? color.textOnAccent : color.textSecondary} />
        </Circle>
      </Animated.View>
      {offered.map((kind, i) => {
        const Icon = TYPE_ICONS[kind];
        // With every type on by default the type circles stay dark, as before;
        // with some off in Settings, the ones showing are lit.
        const active = shown.has(kind) && !(allActive && everyType);
        return (
          <Animated.View key={kind} style={fanOut(t, i + 1, n)}>
            <Circle
              active={active} fill={color.media[kind]} label={TYPE_PLURAL[kind] ?? kind}
              hint={allActive && everyType ? 'Tap to see only this type, hold to hide it' : active ? 'Tap to hide this type' : 'Tap to add this type'}
              onPress={() => f.tapType(kind, offered)} onLongPress={() => f.exclude(kind, offered)}>
              <Icon size={16} color={active ? color.textOnAccent : color.textSecondary} />
            </Circle>
          </Animated.View>
        );
      })}
      {folded ? (
        <Animated.View style={fanOut(t, n - 1, n)}>
          <Pressable onPress={() => { haptics.tap(); fold(); }} accessibilityRole="button" accessibilityLabel="Close the type filter" hitSlop={6} style={styles.fold}>
            <ChevronLeft size={16} color={color.textSecondary} />
          </Pressable>
        </Animated.View>
      ) : null}
    </View>
  );
}

// ── Tabs ─────────────────────────────────────────────────────────────────────

export interface TabDef<K extends string> { key: K; label: string; Icon: typeof Gamepad2 }

/** Underlined text tabs with an icon each: Wishlist, Progress, Library. */
export function Tabs<K extends string>({ tabs, active, onChange }: { tabs: TabDef<K>[]; active: K; onChange: (k: K) => void }) {
  return (
    <View accessibilityRole="tablist" style={styles.tabs}>
      {tabs.map(({ key, label, Icon }) => {
        const on = key === active;
        return (
          <Pressable
            key={key}
            onPress={() => onChange(key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            hitSlop={{ top: 12, bottom: 4 }}
            style={[styles.tab, on && styles.tabOn]}>
            <Icon size={14} color={on ? color.textPrimary : color.neutral400} />
            <Text style={[type.label, { color: on ? color.textPrimary : color.neutral400 }]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ── The bar ──────────────────────────────────────────────────────────────────

export function SubBar<S extends string>({ tabs, filters, trailing, search, count, sort, actions }: {
  tabs?: ReactNode;
  /** Other chips on the type filter's row: the calendar's scopes. */
  filters?: ReactNode;
  /** At the far end of the type filter's row: the Filters button. */
  trailing?: ReactNode;
  search?: { value: string; onChange: (v: string) => void; placeholder: string };
  /** "TITLES · 1,945" */
  count?: { noun: string; n: number } | null;
  sort?: { value: S; options: [S, string][]; onChange: (v: S) => void };
  actions?: ReactNode;
}) {
  const [rowWidth, setRowWidth] = useState(0);
  const [claims, setClaims] = useState<Record<string, number>>({});
  const claim = useCallback((id: string, px: number) => {
    setClaims((c) => (c[id] === px ? c : { ...c, [id]: px }));
    return () => setClaims((c) => { const n = { ...c }; delete n[id]; return n; });
  }, []);
  const parts = Object.values(claims);
  // The groups, the gaps between them, and one more circle for whatever else
  // sits on the row unclaimed (the calendar's month/list toggle).
  const claimed = parts.length ? parts.reduce((a, b) => a + b, 0) + parts.length * 8 + (filters ? 48 : 0) : 0;
  const room = useMemo(() => ({ width: rowWidth, claim, claimed }), [rowWidth, claim, claimed]);

  // Out of the way while the list scrolls down, back on any scroll up. A phone
  // only. Over a list it floats and slides, and never moves the list (lib/barScroll.tsx).
  const { width } = useWindowDimensions();
  const phone = width < breakpoint.md;
  const frame = useBarFrame();
  const setFrameHeight = frame?.setHeight;
  const [barHeight, setBarHeight] = useState(0);
  useLayoutEffect(() => setFrameHeight?.(phone ? barHeight : 0), [setFrameHeight, phone, barHeight]);
  const floating = !!frame?.floating;
  const hide = !!frame?.hidden;
  const shift = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(shift, { toValue: hide ? -barHeight : 0, duration: 200, useNativeDriver: Platform.OS !== 'web' }).start();
  }, [hide, barHeight, shift]);

  return (
    // box-none: once the bar has slid away, the list under this frame takes the touches.
    <View style={[{ overflow: 'hidden', pointerEvents: 'box-none' }, floating && styles.float]}>
    <Animated.View style={[styles.bar, { transform: [{ translateY: shift }] }]} onLayout={(e) => setBarHeight(Math.ceil(e.nativeEvent.layout.height))}>
      <View style={styles.inner}>
        <View style={styles.top}>
          <ChipRoom.Provider value={room}>
            <View style={styles.row} onLayout={(e) => setRowWidth(Math.floor(e.nativeEvent.layout.width))}>
              <TypeFilter />
              {filters ? <Reanimated.View layout={ROW_MOVE} style={styles.rowPart}>{filters}</Reanimated.View> : null}
            </View>
          </ChipRoom.Provider>
          {trailing}
        </View>
        {tabs}
        {search ? <SearchBar value={search.value} onChange={search.onChange} placeholder={search.placeholder} /> : null}
        {sort || count || actions ? (
          <View style={styles.meta}>
            <Text style={[type.micro, { color: color.accent, letterSpacing: 0.8 }]}>
              {count ? `${count.noun} · ${count.n}` : ''}
            </Text>
            <View style={styles.metaRight}>
              {sort ? <SortMenu value={sort.value} options={sort.options} onChange={sort.onChange} /> : null}
              {actions}
            </View>
          </View>
        ) : null}
      </View>
    </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  float: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1 },
  bar: { backgroundColor: color.surface, borderBottomWidth: 1, borderBottomColor: color.border, paddingHorizontal: 24, paddingVertical: 12 },
  inner: { width: '100%', maxWidth: 1152, alignSelf: 'center', gap: 12 },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  row: { flex: 1, minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 8, rowGap: 20 },
  circles: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowPart: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 8, rowGap: 20 },
  circle: {
    width: 40, height: 40, borderRadius: radius.full, borderWidth: 1, borderColor: color.borderStrong,
    alignItems: 'center', justifyContent: 'center',
  },
  fold: { width: 28, height: 40, alignItems: 'center', justifyContent: 'center' },
  count: {
    position: 'absolute', top: -2, right: -2, minWidth: 16, height: 16, paddingHorizontal: 4, borderRadius: radius.full,
    backgroundColor: color.accent, alignItems: 'center', justifyContent: 'center',
  },
  countText: { fontFamily: 'SpaceMono_400Regular', fontSize: 10, lineHeight: 14, color: color.textOnAccent },
  tabs: { flexDirection: 'row', alignItems: 'center', gap: 20, borderBottomWidth: 1, borderBottomColor: color.border },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingBottom: 12, borderBottomWidth: 2, borderBottomColor: 'transparent', marginBottom: -1 },
  tabOn: { borderBottomColor: color.accent },
  meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingTop: 2, minHeight: 30 },
  metaRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
