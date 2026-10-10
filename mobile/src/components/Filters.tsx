// The Filters sheet that Search, Wishlist and Library share. Port of the site's
// src/components/discovery/FilterPanel.tsx and SubBar's sheet: must include and
// must exclude (a tag, a person or a studio, found by typing), your lists (any,
// only, hide), and a release year range, with a count, Reset all, and a button
// that says how many titles are left.
//
// Everything is answered from the catalog on the device. A title's tags, people
// and studios are read once, when a filter first needs them.
//
// Not carried over: "Available on". The catalog copy on the device does not say
// which platforms or streaming services a title is on.

import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import { SlidersHorizontal, X } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { groupOfKey, narrowToOwned, platformMarkName, withKnownPlatforms, type PlatformGroup, type PlatformOption } from '@/lib/platformKeys';
import { BrandGlyph } from '~/components/BrandGlyph';
import { Button, Sheet } from '~/components/kit';
import { useAuth } from '~/lib/AuthProvider';
import { shelfItemIds, usePlatformIndex } from '~/lib/platforms';
import { useTypeFilter } from '~/lib/typeFilter';
import type { CardItem, CardState } from '~/lib/cards';
import { useCatalogSync } from '~/lib/CatalogSyncProvider';
import { color, font, radius, type } from '~/theme';

export interface FacetPill { kind: 'tag' | 'person' | 'company'; key: string; label: string }
type Membership = 'only' | 'exclude' | undefined;

export interface Filters {
  include: FacetPill[];
  exclude: FacetPill[];
  membership: { library?: Membership; wishlist?: Membership; rated?: Membership };
  /** Empty means no bound. */
  yearFrom: string;
  yearTo: string;
  /** Platform keys (`p:` a console, `s:` a streaming service). Any one of them is enough. */
  platforms: string[];
}

export const noFilters = (): Filters => ({ include: [], exclude: [], membership: {}, yearFrom: '', yearTo: '', platforms: [] });

export function countActive(f: Filters): number {
  return f.include.length + f.exclude.length
    + Object.values(f.membership).filter(Boolean).length
    + (f.yearFrom ? 1 : 0) + (f.yearTo ? 1 : 0) + f.platforms.length;
}

const pillId = (p: { kind: string; key: string }) => `${p.kind}|${p.key}`;

// ── What every title carries, read once ──────────────────────────────────────

interface Vocab {
  /** Title id to the ids of its tags, people and studios. A person counts once, whatever the role. */
  byItem: Map<string, Set<string>>;
  /** Every tag, person and studio, most used first. */
  options: (FacetPill & { count: number })[];
}

let vocab: { revision: number; value: Vocab } | null = null;

async function loadVocab(db: SQLiteDatabase, revision: number): Promise<Vocab> {
  if (vocab?.revision === revision) return vocab.value;
  const rows = await db.getAllAsync<{ id: string; facets: string }>('SELECT id, facets FROM catalog');
  const byItem = new Map<string, Set<string>>();
  const counts = new Map<string, FacetPill & { count: number }>();
  for (const r of rows) {
    const ids = new Set<string>();
    try {
      for (const f of JSON.parse(r.facets) as { kind: string; key: string; label: string }[]) {
        if (f.kind !== 'tag' && f.kind !== 'person' && f.kind !== 'company') continue;
        const id = pillId(f);
        if (ids.has(id)) continue;
        ids.add(id);
        const cur = counts.get(id);
        if (cur) cur.count++; else counts.set(id, { kind: f.kind, key: f.key, label: f.label, count: 1 });
      }
    } catch { /* a row with unreadable facets matches no facet filter */ }
    byItem.set(r.id, ids);
  }
  const value = { byItem, options: [...counts.values()].sort((a, b) => b.count - a.count) };
  vocab = { revision, value };
  return value;
}

/**
 * The titles a set of filters leaves. `stateOf` is only asked when a list
 * filter is on, and the facets are only read when a facet filter is.
 */
export function useFiltered<T extends CardItem>(items: T[], filters: Filters, stateOf: (id: string | null) => CardState): T[] {
  const db = useSQLiteContext();
  const sync = useCatalogSync();
  const needsFacets = filters.include.length > 0 || filters.exclude.length > 0;
  const needsPlatforms = filters.platforms.length > 0;
  const platforms = usePlatformIndex(needsPlatforms);
  const [facets, setFacets] = useState<Vocab | null>(null);
  useEffect(() => {
    let live = true;
    if (!needsFacets) return;
    void loadVocab(db, sync.revision).then((v) => { if (live) setFacets(v); });
    return () => { live = false; };
  }, [db, needsFacets, sync.revision]);

  return useMemo(() => {
    const from = Number(filters.yearFrom) || null;
    const to = Number(filters.yearTo) || null;
    const { library, wishlist, rated } = filters.membership;
    const listed = !!(library || wishlist || rated);
    if (!needsFacets && !needsPlatforms && !from && !to && !listed) return items;
    const wanted = new Set(filters.platforms);
    const want = (rule: Membership, is: boolean) => !rule || (rule === 'only' ? is : !is);
    return items.filter((it) => {
      if (from || to) {
        const y = Number(it.releaseDate?.slice(0, 4));
        // A title with no date has no year to be inside a range.
        if (!Number.isFinite(y) || !y) return false;
        if (from && y < from) return false;
        if (to && y > to) return false;
      }
      if (listed) {
        const s = stateOf(it.id);
        if (!want(library, s.inLibrary) || !want(wishlist, s.wishlisted) || !want(rated, s.rating != null && s.rating > 0)) return false;
      }
      if (needsFacets) {
        // Until the facets are read, a facet filter matches nothing: better an empty moment than a wrong list.
        const mine = it.id ? facets?.byItem.get(it.id) : undefined;
        if (!mine) return false;
        if (!filters.include.every((p) => mine.has(pillId(p)))) return false;
        if (filters.exclude.some((p) => mine.has(pillId(p)))) return false;
      }
      if (needsPlatforms) {
        // A title we hold no availability for is hidden while this is on, as on the site.
        const keys = platforms?.keysOf(it.id);
        if (!keys || !keys.some((k) => wanted.has(k))) return false;
      }
      return true;
    });
  }, [items, filters, stateOf, needsFacets, facets, needsPlatforms, platforms]);
}

// ── The button on the list header ────────────────────────────────────────────

export function FiltersButton({ active, onPress }: { active: number; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={active ? `Filters (${active} active)` : 'Filters'}
      hitSlop={2}
      style={({ pressed }) => [styles.circle, active > 0 && { borderColor: color.accent }, pressed && { opacity: 0.7 }]}>
      <SlidersHorizontal size={16} color={active ? color.accent : color.textSecondary} />
      {active ? <View style={styles.badge}><Text style={styles.badgeText}>{active}</Text></View> : null}
    </Pressable>
  );
}

// ── The sheet ────────────────────────────────────────────────────────────────

const KIND_WORD: Record<string, string> = { tag: 'Tag', person: 'Person', company: 'Studio' };

/** Type a few letters, pick a tag, a person or a studio. */
function FacetPicker({ picked, tint, onAdd, onRemove }: { picked: FacetPill[]; tint: string; onAdd: (p: FacetPill) => void; onRemove: (i: number) => void }) {
  const db = useSQLiteContext();
  const sync = useCatalogSync();
  const [text, setText] = useState('');
  const [options, setOptions] = useState<Vocab['options']>([]);
  useEffect(() => {
    let live = true;
    void loadVocab(db, sync.revision).then((v) => { if (live) setOptions(v.options); });
    return () => { live = false; };
  }, [db, sync.revision]);

  const term = text.trim().toLowerCase();
  const matches = useMemo(() => {
    if (term.length < 2) return [];
    const taken = new Set(picked.map(pillId));
    const out: Vocab['options'] = [];
    // Names that start with what was typed, before names that merely contain it.
    for (const pass of [0, 1]) {
      for (const o of options) {
        if (out.length >= 8) break;
        const l = o.label.toLowerCase();
        if (taken.has(pillId(o)) || out.includes(o)) continue;
        if (pass === 0 ? l.startsWith(term) : l.includes(term)) out.push(o);
      }
    }
    return out;
  }, [term, options, picked]);

  return (
    <View style={{ gap: 8 }}>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="tag, person, studio…"
        placeholderTextColor={color.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
      />
      {matches.length ? (
        <View style={styles.suggestions}>
          {matches.map((o) => (
            <Pressable key={pillId(o)} onPress={() => { onAdd({ kind: o.kind, key: o.key, label: o.label }); setText(''); }} accessibilityRole="button" style={({ pressed }) => [styles.suggestion, pressed && { backgroundColor: color.fillIdle }]}>
              <Text numberOfLines={1} style={[type.bodySm, { flex: 1, color: color.textPrimary }]}>{o.label}</Text>
              <Text style={type.meta}>{KIND_WORD[o.kind]} · {o.count}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {picked.length ? (
        <View style={styles.pills}>
          {picked.map((p, i) => (
            <Pressable key={pillId(p)} onPress={() => onRemove(i)} accessibilityRole="button" accessibilityLabel={`Remove ${p.label}`} style={[styles.pill, { backgroundColor: `${tint}24` }]}>
              <Text style={[type.label, { color: tint }]}>{p.label}</Text>
              <X size={12} color={tint} />
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Tri({ label, value, onChange }: { label: string; value: Membership; onChange: (v: Membership) => void }) {
  const opts: [string, Membership][] = [['Any', undefined], ['Only', 'only'], ['Hide', 'exclude']];
  return (
    <View style={styles.triRow}>
      <Text style={[type.bodySm, { color: color.textPrimary }]}>{label}</Text>
      <View accessibilityLabel={label} style={styles.tri}>
        {opts.map(([word, v]) => {
          const on = value === v;
          return (
            <Pressable key={word} onPress={() => onChange(v)} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.triCell, on && { backgroundColor: color.accentSubtle }]}>
              <Text style={[type.label, { color: on ? color.accent : color.textSecondary }]}>{word}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 10 }}>
      <Text style={[type.eyebrow, { color: color.accent }]}>{label}</Text>
      {children}
    </View>
  );
}

const PLATFORM_PREVIEW = 8;

function PlatformChip({ option, active, onToggle }: { option: PlatformOption; active: boolean; onToggle: () => void }) {
  const empty = option.count === 0;
  const ink = active ? color.textPrimary : empty ? color.textMuted : color.textSecondary;
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[styles.platformChip, active ? styles.platformChipOn : empty && { borderColor: color.border }]}
    >
      <BrandGlyph source={platformMarkName(option.label)} size={16} tint={ink} />
      <Text numberOfLines={1} style={[type.label, { color: ink }]}>{option.label}</Text>
      <Text style={[type.meta, { color: color.textMuted }]}>{option.count}</Text>
    </Pressable>
  );
}

function PlatformGroupRow({ label, options, selected, onToggle, emptyHint }: {
  label: string; options: PlatformOption[]; selected: string[]; onToggle: (k: string) => void; emptyHint: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? options : options.filter((o, i) => i < PLATFORM_PREVIEW || selected.includes(o.key));
  const hidden = options.length - shown.length;
  return (
    <View style={{ gap: 8 }}>
      <Text style={[type.meta, { color: color.textMuted }]}>{label}</Text>
      {options.length === 0 ? <Text style={[type.caption, { color: color.textMuted }]}>{emptyHint}</Text> : (
        <View style={styles.pills}>
          {shown.map((o) => <PlatformChip key={o.key} option={o} active={selected.includes(o.key)} onToggle={() => onToggle(o.key)} />)}
          {hidden > 0 ? (
            <Pressable onPress={() => setExpanded(true)} accessibilityRole="button" style={[styles.platformChip, styles.platformMore]}>
              <Text style={[type.label, { color: color.accent }]}>+{hidden} more</Text>
            </Pressable>
          ) : null}
          {expanded && options.length > PLATFORM_PREVIEW ? (
            <Pressable onPress={() => setExpanded(false)} accessibilityRole="button" style={[styles.platformChip, styles.platformMore]}>
              <Text style={[type.label, { color: color.textSecondary }]}>Show less</Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
  );
}

/** "Available on": the services and consoles the list's titles are on, narrowed to the ones you own. */
function AvailableOn({ items, selected, onChange, onEdit }: {
  items: CardItem[]; selected: string[]; onChange: (next: string[]) => void; onEdit?: () => void;
}) {
  const db = useSQLiteContext();
  const auth = useAuth();
  const types = useTypeFilter().shown as string[];
  const index = usePlatformIndex();
  const owned = auth.profile?.user.platforms ?? null;
  const [shelf, setShelf] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    if (auth.status !== 'signedIn') { setShelf([]); return; }
    void shelfItemIds(db).then((ids) => { if (live) setShelf(ids); });
    return () => { live = false; };
  }, [db, auth.status, auth.rowsRevision]);

  const { all, narrowed } = useMemo(() => {
    if (!index) return { all: [] as PlatformOption[], narrowed: [] as PlatformOption[] };
    // What this list offers, plus what your own shelves are on (at a count of 0
    // when nothing here is on it), so a platform you own never drops off the row.
    const merged = withKnownPlatforms(index.optionsFor(items.map((i) => i.id)), index.optionsFor(shelf));
    return { all: merged, narrowed: narrowToOwned(merged, owned, selected) };
  }, [index, items, shelf, owned, selected]);

  const toggle = (key: string) => onChange(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]);
  const showStreaming = types.includes('movie') || types.includes('show');
  const showGames = types.includes('game');
  const hint = (group: PlatformGroup, none: string) =>
    owned?.length && !owned.some((k) => groupOfKey(k) === group) ? 'You have not picked any of these in your platforms, in Settings.' : none;

  return (
    <Section label={`Available on · ${auth.region}`}>
      {!index ? <Text style={type.bodySm}>Loading where things can be watched and played…</Text>
        : !showStreaming && !showGames ? <Text style={type.bodySm}>Nothing to filter: no media types are switched on.</Text> : (
          <View style={{ gap: 12 }}>
            {showStreaming ? (
              <PlatformGroupRow
                label="Movies & shows" options={narrowed.filter((o) => o.group === 'streaming')} selected={selected} onToggle={toggle}
                emptyHint={hint('streaming', 'Nothing loaded here says where it streams. Upcoming releases usually don’t yet.')}
              />
            ) : null}
            {showGames ? (
              <PlatformGroupRow
                label="Games" options={narrowed.filter((o) => o.group === 'games')} selected={selected} onToggle={toggle}
                emptyHint={hint('games', 'Nothing loaded here says which platforms it runs on.')}
              />
            ) : null}
            {narrowed.length < all.length ? (
              <Text style={[type.caption, { color: color.textMuted }]}>
                Showing the platforms you own.{onEdit ? ' ' : ''}
                {onEdit ? <Text onPress={onEdit} accessibilityRole="link" style={{ color: color.accent, textDecorationLine: 'underline' }}>Edit</Text> : null}
              </Text>
            ) : null}
            {selected.length > 0 ? (
              <Text style={[type.caption, { color: color.textMuted }]}>Titles we hold no availability for are hidden while this is on.</Text>
            ) : null}
          </View>
        )}
    </Section>
  );
}

export function FilterSheet({ open, onClose, filters, onChange, resultCount, noun, signedIn, items, onEditPlatforms }: {
  /** The list before these filters, so each platform can say how many of it there are. */
  items: CardItem[];
  /** Opens Settings, where "Your platforms" is edited. */
  onEditPlatforms?: () => void;
  open: boolean;
  onClose: () => void;
  filters: Filters;
  onChange: (next: Filters) => void;
  resultCount: number;
  noun: string;
  signedIn: boolean;
}) {
  const active = countActive(filters);
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  const year = (v: string) => v.replace(/[^0-9]/g, '').slice(0, 4);
  return (
    <Sheet open={open} onClose={onClose} title="Filters">
      <View style={styles.head}>
        <Text style={type.serifMd}>Filters</Text>
        {active ? <View style={styles.headCount}><Text style={[type.meta, { color: color.textOnAccent }]}>{active}</Text></View> : null}
        <View style={{ flex: 1 }} />
        {active ? (
          <Pressable onPress={() => onChange(noFilters())} accessibilityRole="button" style={styles.reset}>
            <Text style={[type.label, { color: color.accent }]}>Reset all</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" style={styles.close}>
          <X size={18} color={color.textSecondary} />
        </Pressable>
      </View>
      <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Section label="Must include">
          <FacetPicker picked={filters.include} tint={color.accent} onAdd={(p) => set({ include: [...filters.include, p] })} onRemove={(i) => set({ include: filters.include.filter((_, j) => j !== i) })} />
        </Section>
        <Section label="Must exclude">
          <FacetPicker picked={filters.exclude} tint={color.danger} onAdd={(p) => set({ exclude: [...filters.exclude, p] })} onRemove={(i) => set({ exclude: filters.exclude.filter((_, j) => j !== i) })} />
        </Section>
        {signedIn ? (
          <Section label="Your lists">
            <Tri label="In library" value={filters.membership.library} onChange={(v) => set({ membership: { ...filters.membership, library: v } })} />
            <Tri label="On wishlist" value={filters.membership.wishlist} onChange={(v) => set({ membership: { ...filters.membership, wishlist: v } })} />
            <Tri label="Rated" value={filters.membership.rated} onChange={(v) => set({ membership: { ...filters.membership, rated: v } })} />
          </Section>
        ) : null}
        {open ? <AvailableOn items={items} selected={filters.platforms} onChange={(platforms) => set({ platforms })} onEdit={onEditPlatforms} /> : null}
        <Section label="Release year">
          <View style={styles.years}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={type.caption}>From</Text>
              <TextInput value={filters.yearFrom} onChangeText={(v) => set({ yearFrom: year(v) })} placeholder="any" placeholderTextColor={color.textSecondary} keyboardType="number-pad" accessibilityLabel="From year" style={styles.input} />
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={type.caption}>To</Text>
              <TextInput value={filters.yearTo} onChangeText={(v) => set({ yearTo: year(v) })} placeholder="any" placeholderTextColor={color.textSecondary} keyboardType="number-pad" accessibilityLabel="To year" style={styles.input} />
            </View>
          </View>
        </Section>
      </ScrollView>
      <View style={styles.foot}>
        <Button
          label={`Show ${resultCount.toLocaleString('en')} ${resultCount === 1 ? noun.replace(/s$/, '') : noun}`}
          variant="primary" size="lg" pill onPress={onClose}
        />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  circle: { width: 40, height: 40, borderRadius: radius.full, borderWidth: 1, borderColor: color.borderStrong, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute', top: -2, right: -2, minWidth: 16, height: 16, paddingHorizontal: 4, borderRadius: radius.full,
    backgroundColor: color.accent, alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { fontFamily: font.mono, fontSize: 10, lineHeight: 14, color: color.textOnAccent },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: color.border },
  headCount: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.full, backgroundColor: color.accent },
  reset: { minHeight: 44, paddingHorizontal: 10, justifyContent: 'center' },
  close: { width: 44, height: 44, marginRight: -10, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: 20, paddingVertical: 16, gap: 20 },
  foot: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20, borderTopWidth: 1, borderTopColor: color.border },
  input: {
    height: 44, paddingHorizontal: 14, color: color.textPrimary, fontFamily: font.sans, fontSize: 13,
    backgroundColor: color.surfaceElevated, borderWidth: 1, borderColor: color.border, borderRadius: radius.lg,
  },
  suggestions: { borderWidth: 1, borderColor: color.border, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: color.surfaceElevated },
  suggestion: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  platformChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 12,
    borderRadius: radius.full, borderWidth: 1, borderColor: color.borderStrong,
  },
  platformChipOn: { backgroundColor: color.accentSubtle, borderColor: color.accent },
  platformMore: { borderStyle: 'dashed' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 6, borderRadius: radius.full },
  triRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  tri: { flexDirection: 'row', borderWidth: 1, borderColor: color.borderStrong, borderRadius: radius.lg, overflow: 'hidden' },
  triCell: { minWidth: 56, minHeight: 36, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  years: { flexDirection: 'row', gap: 12 },
});
