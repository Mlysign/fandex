// The header every list screen shares: the type filter, the tabs, a search
// field, and a line with the count on the left and the sort on the right.
// Ports of src/components/SubBar.tsx, ui/TypeFilter.tsx, ui/CollapsibleChips.tsx
// and LibraryWishlistTabs.tsx.
//
// The Filters sheet is components/Filters.tsx. Not carried over yet: hiding
// the bar while scrolling down.

import { Clapperboard, Gamepad2, Tv } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { MEDIA_TYPES } from '@/lib/mediaTypes';
import { SearchBar, SortMenu } from '~/components/kit';
import { LogoOutline } from '~/components/Logo';
import { useTypeFilter } from '~/lib/typeFilter';
import { breakpoint, color, radius, type, TYPE_PLURAL } from '~/theme';

const TYPE_ICONS: Record<string, typeof Gamepad2> = { game: Gamepad2, movie: Clapperboard, show: Tv };

// ── The type filter ──────────────────────────────────────────────────────────

function Circle({ active, fill, label, onPress, children, count }: {
  active: boolean; fill?: string; label: string; onPress: () => void; children: ReactNode; count?: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      hitSlop={2}
      style={({ pressed }) => [styles.circle, active && fill ? { backgroundColor: fill, borderColor: fill } : null, pressed && { opacity: 0.7 }]}>
      {children}
      {count ? <View style={styles.count}><Text style={styles.countText}>{count}</Text></View> : null}
    </Pressable>
  );
}

/**
 * Icon circles, one per media type, and one for all of them. Under 1024 px
 * they fold into a single circle that says what is picked, and open on a tap.
 */
export function TypeFilter() {
  const f = useTypeFilter();
  const { width } = useWindowDimensions();
  const roomy = width >= breakpoint.lg;
  const [open, setOpen] = useState(false);

  const shown = new Set<string>(f.shown);
  const allActive = MEDIA_TYPES.every((t) => shown.has(t));
  const selected = MEDIA_TYPES.filter((t) => shown.has(t));

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

  return (
    <View style={styles.circles} accessibilityLabel="Filter by type">
      <Circle active={allActive} fill={color.accent} label="All types" onPress={f.selectAll}>
        <LogoOutline tint={allActive ? color.textOnAccent : color.textSecondary} />
      </Circle>
      {MEDIA_TYPES.map((t) => {
        const Icon = TYPE_ICONS[t];
        const active = !allActive && shown.has(t);
        return (
          <Circle key={t} active={active} fill={color.media[t]} label={TYPE_PLURAL[t] ?? t} onPress={() => f.toggle(t)}>
            <Icon size={16} color={active ? color.textOnAccent : color.textSecondary} />
          </Circle>
        );
      })}
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
  return (
    <View style={styles.bar}>
      <View style={styles.inner}>
        <View style={styles.top}>
          <View style={styles.row}>
            <TypeFilter />
            {filters}
          </View>
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
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { backgroundColor: color.surface, borderBottomWidth: 1, borderBottomColor: color.border, paddingHorizontal: 24, paddingVertical: 12 },
  inner: { width: '100%', maxWidth: 1152, alignSelf: 'center', gap: 12 },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  row: { flex: 1, minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 8, rowGap: 20 },
  circles: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  circle: {
    width: 40, height: 40, borderRadius: radius.full, borderWidth: 1, borderColor: color.borderStrong,
    alignItems: 'center', justifyContent: 'center',
  },
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
