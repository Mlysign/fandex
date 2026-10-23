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
import { Animated, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { MEDIA_TYPES } from '@/lib/mediaTypes';
import { SearchBar, SortMenu } from '~/components/kit';
import { LogoOutline } from '~/components/Logo';
import { useTypeFilter } from '~/lib/typeFilter';
import { useOfferedTypes } from '~/lib/features';
import { TYPE_ICONS as SHARED_TYPE_ICONS } from '~/lib/typeIcons';
import { useOutsideClose } from '~/lib/useOutsideClose';
import { useBarFrame } from '~/lib/barScroll';
import { breakpoint, color, radius, type, TYPE_PLURAL } from '~/theme';

const TYPE_ICONS: Record<string, typeof Gamepad2> = SHARED_TYPE_ICONS;

// ── The type filter ──────────────────────────────────────────────────────────

function Circle({ active, fill, label, hint, onPress, onLongPress, children, count }: {
  active: boolean; fill?: string; label: string; hint?: string; onPress: () => void; onLongPress?: () => void; children: ReactNode; count?: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityHint={hint}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      // A browser has no "selected" for a button; pressed is what a toggle is there.
      {...(Platform.OS === 'web' ? ({ 'aria-pressed': active } as object) : null)}
      accessibilityLabel={label}
      hitSlop={2}
      style={({ pressed }) => [styles.circle, active && fill ? { backgroundColor: fill, borderColor: fill } : null, pressed && { opacity: 0.7 }]}>
      {children}
      {count ? <View style={styles.count}><Text style={styles.countText}>{count}</Text></View> : null}
    </Pressable>
  );
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
  useOutsideClose(open, useCallback(() => setOpen(false), []), group);

  const shown = new Set<string>(f.shown);
  const allActive = offered.every((t) => shown.has(t));
  const selected = offered.filter((t) => shown.has(t));

  if (!open && !roomy) {
    const Only = selected.length === 1 ? TYPE_ICONS[selected[0]] : null;
    return (
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityState={{ expanded: false }}
        accessibilityLabel={allActive ? 'Filter by type' : `Filter by type (${selected.length} selected)`}
        hitSlop={2}
        style={({ pressed }) => [styles.circle, !allActive && { borderColor: color.accent }, pressed && { opacity: 0.7 }]}>
        {Only ? <Only size={16} color={color.media[selected[0]]} /> : <LogoOutline tint={allActive ? color.textSecondary : color.accent} />}
        {!allActive && selected.length > 1 ? <View style={styles.count}><Text style={styles.countText}>{selected.length}</Text></View> : null}
      </Pressable>
    );
  }

  // One tap narrows a full row to that type; from a partial row a tap adds or
  // drops; a long press hides one type (lib/typeFilter.tsx, `tapType`). The
  // logo circle shows every type and, on a folded bar, closes the row: it used
  // to only select, so the row could not be put away (Nils, 2026-10-18).
  const folded = !roomy;
  return (
    <View ref={group} style={styles.circles} accessibilityLabel="Filter by type">
      <Circle active={allActive} fill={color.accent} label="All types" hint={folded ? 'Shows every type and closes the row' : undefined}
        onPress={() => { f.selectAll(); if (folded) setOpen(false); }}>
        <LogoOutline tint={allActive ? color.textOnAccent : color.textSecondary} />
      </Circle>
      {offered.map((t) => {
        const Icon = TYPE_ICONS[t];
        const active = !allActive && shown.has(t);
        return (
          <Circle
            key={t} active={active} fill={color.media[t]} label={TYPE_PLURAL[t] ?? t}
            hint={allActive ? 'Tap to see only this type, hold to hide it' : active ? 'Tap to hide this type' : 'Tap to add this type'}
            onPress={() => f.tapType(t, offered)} onLongPress={() => f.exclude(t, offered)}>
            <Icon size={16} color={active ? color.textOnAccent : color.textSecondary} />
          </Circle>
        );
      })}
      {folded ? (
        <Pressable onPress={() => setOpen(false)} accessibilityRole="button" accessibilityLabel="Close the type filter" hitSlop={6} style={styles.fold}>
          <ChevronLeft size={16} color={color.textSecondary} />
        </Pressable>
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
              {filters}
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
