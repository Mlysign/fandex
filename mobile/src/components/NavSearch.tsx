// The desktop nav bar's search box. A port of the site's src/components/NavSearch.tsx:
// a circle that opens into a field, suggestions in three groups (People, Tags,
// Titles) from the catalog copy on this device, arrows and Enter to pick, and
// Enter with nothing picked hands the text to Search, which also asks the
// providers. Escape or a click outside closes it.
//
// The site asked its server for the suggestions. Here they come from the
// device: people and tags from lib/facetVocab.ts (the vocabulary Search's own
// chips use), titles from the catalog copy.
//
// Only in the app. The website's static pages render AppNav without it, and
// there the circle stays a plain link to Search.

import { useRouter } from 'expo-router';
import type { SQLiteDatabase } from 'expo-sqlite';
import { useSQLiteContext } from 'expo-sqlite';
import { Search } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { keyToSlug } from '@/lib/facetUrl';
import { searchKey } from '@/lib/normalize';
import { itemHref } from '~/lib/cardHref';
import { useCatalogSync } from '~/lib/CatalogSyncProvider';
import { spokenKey } from '~/lib/facetImpact';
import { facetVocab, matchVocab, type VocabEntry } from '~/lib/facetVocab';
import { handSearchQuery } from '~/lib/searchHandoff';
import { color, font, radius, type, TYPE_LABEL } from '~/theme';

const MIN_CHARS = 3;
const PER_GROUP = 5;

interface TitleRow { id: string; type: string; title: string; slug: string | null; year: number | null; votes: number; key: string }

let titlesCache: { db: SQLiteDatabase; revision: number; rows: Promise<TitleRow[]> } | null = null;
function titleIndex(db: SQLiteDatabase, revision: number): Promise<TitleRow[]> {
  if (!titlesCache || titlesCache.db !== db || titlesCache.revision !== revision) {
    const rows = db.getAllAsync<{ id: string; type: string; title: string; slug: string | null; year: number | null; community_votes: number }>(
      'SELECT id, type, title, slug, year, community_votes FROM catalog',
    ).then((r) => r.map((x) => ({ id: x.id, type: x.type, title: x.title, slug: x.slug, year: x.year, votes: x.community_votes ?? 0, key: searchKey(x.title) })));
    titlesCache = { db, revision, rows };
    rows.catch(() => { if (titlesCache?.rows === rows) titlesCache = null; });
  }
  return titlesCache.rows;
}

/** Titles whose name holds the query: the whole name first, then a word starting with it, then the rest; better known first. */
export function matchTitles(rows: TitleRow[], norm: string, limit = PER_GROUP): TitleRow[] {
  const rank = (r: TitleRow) => (r.key === norm ? 0 : r.key.startsWith(norm) || r.key.includes(` ${norm}`) ? 1 : 2);
  return rows.filter((r) => r.key.includes(norm)).sort((a, b) => rank(a) - rank(b) || b.votes - a.votes).slice(0, limit);
}

type Option =
  | { group: 'People' | 'Tags'; href: string; label: string; meta: string; key: string }
  | { group: 'Titles'; href: string; label: string; meta: string; key: string };

const facetOption = (group: 'People' | 'Tags', e: VocabEntry): Option => ({
  group,
  href: e.kind === 'person' ? `/person/${keyToSlug(e.key)}` : `/tag/${keyToSlug(spokenKey(e.key))}`,
  label: e.label,
  meta: `${e.kind === 'person' ? 'person' : 'tag'} · ${e.count}`,
  key: `${e.kind}|${e.key}`,
});

export function NavSearch() {
  const db = useSQLiteContext();
  const { revision } = useCatalogSync();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [options, setOptions] = useState<Option[]>([]);
  const [searched, setSearched] = useState(false);
  const [active, setActive] = useState(-1);
  const root = useRef<View>(null);
  const input = useRef<TextInput>(null);

  const reset = () => { setOpen(false); setQ(''); setOptions([]); setSearched(false); setActive(-1); };

  useEffect(() => {
    const norm = searchKey(q.trim());
    if (norm.length < MIN_CHARS) { setOptions([]); setSearched(false); setActive(-1); return; }
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const [vocab, titles] = await Promise.all([facetVocab(db, revision), titleIndex(db, revision)]);
        if (!live) return;
        const { people, tags } = matchVocab(vocab, norm, PER_GROUP);
        setOptions([
          ...people.map((e) => facetOption('People', e)),
          ...tags.map((e) => facetOption('Tags', e)),
          ...matchTitles(titles, norm).map((t): Option => ({
            group: 'Titles', href: itemHref(t), label: t.title, meta: `${t.year ?? ''} · ${TYPE_LABEL[t.type] ?? t.type}`, key: `title|${t.id}`,
          })),
        ]);
        setSearched(true);
        setActive(-1);
      } catch { if (live) setSearched(false); }
    }, 150);
    return () => { live = false; clearTimeout(timer); };
  }, [q, db, revision]);

  // A click anywhere else closes it (the site's outside pointerdown).
  useEffect(() => {
    if (!open || Platform.OS !== 'web') return;
    const onDown = (e: PointerEvent) => {
      const node = root.current as unknown as HTMLElement | null;
      if (node && !node.contains(e.target as Node)) reset();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  const go = (href: string) => { reset(); router.navigate(href as never); };
  // Enter with nothing picked: Search, which asks the providers as well as the catalog.
  const searchAll = (term: string) => { reset(); handSearchQuery(term); router.navigate('/discover' as never); };

  const onKey = (e: { nativeEvent: { key: string }; preventDefault?: () => void }) => {
    const key = e.nativeEvent.key;
    if (key === 'Escape') { reset(); input.current?.blur(); return; }
    if (key === 'ArrowDown' && options.length) { e.preventDefault?.(); setActive((i) => (i + 1) % options.length); return; }
    if (key === 'ArrowUp' && options.length) { e.preventDefault?.(); setActive((i) => (i <= 0 ? options.length - 1 : i - 1)); }
  };
  const onSubmit = () => {
    // A picked option wins; otherwise Enter means "search for what I typed", never the top suggestion.
    const picked = active >= 0 ? options[active] : null;
    if (picked) { go(picked.href); return; }
    const term = q.trim();
    if (term) searchAll(term);
  };

  const groups = useMemo(() => (['People', 'Tags', 'Titles'] as const)
    .map((g) => ({ g, rows: options.map((o, i) => ({ o, i })).filter(({ o }) => o.group === g) }))
    .filter((x) => x.rows.length), [options]);
  const noMatches = searched && q.trim().length >= MIN_CHARS && !options.length;

  if (!open) {
    return (
      <Pressable
        onPress={() => { setOpen(true); setTimeout(() => input.current?.focus(), 0); }}
        accessibilityRole="button"
        accessibilityLabel="Search titles, people and tags"
        hitSlop={4}
        style={styles.circle}>
        <Search size={16} color={color.textSecondary} />
      </Pressable>
    );
  }

  return (
    <View ref={root} style={styles.wrap}>
      <View style={styles.field}>
        <Search size={14} color={color.textSecondary} />
        <TextInput
          ref={input}
          value={q}
          onChangeText={setQ}
          onKeyPress={onKey as never}
          onSubmitEditing={onSubmit}
          placeholder="Search titles, people, tags…"
          placeholderTextColor={color.textSecondary}
          accessibilityLabel="Search titles, people and tags"
          returnKeyType="search"
          autoCorrect={false}
          style={styles.input}
        />
      </View>
      {groups.length || noMatches ? (
        <View style={styles.list} accessibilityRole={Platform.OS === 'web' ? ('listbox' as never) : undefined}>
          {noMatches ? (
            <View>
              <Text style={[type.caption, styles.none]}>No matches in the catalog</Text>
              <Pressable onPress={() => searchAll(q.trim())} style={(s: { hovered?: boolean }) => [styles.row, s.hovered && styles.rowOn]}>
                <Text style={[type.bodySm, { color: color.textSecondary }]} numberOfLines={1}>
                  Search all of Fandex for <Text style={{ color: color.textPrimary }}>{q.trim()}</Text> →
                </Text>
              </Pressable>
            </View>
          ) : groups.map(({ g, rows }) => (
            <View key={g}>
              <Text style={styles.group}>{g}</Text>
              {rows.map(({ o, i }) => (
                <Pressable
                  key={o.key}
                  {...(Platform.OS === 'web' ? ({ href: o.href } as object) : null)}
                  onPress={(e) => { (e as unknown as { preventDefault?: () => void })?.preventDefault?.(); go(o.href); }}
                  onHoverIn={() => setActive(i)}
                  accessibilityRole="link"
                  accessibilityState={{ selected: i === active }}
                  style={[styles.row, i === active && styles.rowOn]}>
                  <Text style={[type.bodySm, { flex: 1, color: i === active ? color.textPrimary : color.textSecondary }]} numberOfLines={1}>{o.label}</Text>
                  <Text style={styles.meta} numberOfLines={1}>{o.meta}</Text>
                </Pressable>
              ))}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    width: 36, height: 36, marginLeft: 4, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center',
    backgroundColor: color.surfaceElevated, borderWidth: 1, borderColor: color.border,
  },
  wrap: { position: 'relative', marginLeft: 4, zIndex: 30 },
  field: {
    height: 36, width: 256, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12,
    borderRadius: radius.full, backgroundColor: color.surfaceElevated, borderWidth: 1, borderColor: color.borderStrong,
  },
  input: { flex: 1, minWidth: 0, fontFamily: font.sans, fontSize: 14, color: color.textPrimary, outlineStyle: 'none' } as object,
  list: {
    position: 'absolute', top: 42, right: 0, width: 256, maxHeight: 320, overflow: 'scroll' as never, paddingVertical: 4,
    borderRadius: radius.lg, borderWidth: 1, borderColor: color.borderStrong, backgroundColor: color.surfaceOverlay,
    shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 16, shadowOffset: { width: 0, height: 8 },
  },
  group: { paddingHorizontal: 12, paddingTop: 6, paddingBottom: 4, fontFamily: font.mono, fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase', color: color.textSecondary },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 6 },
  rowOn: { backgroundColor: color.surfaceElevated },
  meta: { fontSize: 10, color: color.textSecondary, flexShrink: 0 },
  none: { paddingHorizontal: 12, paddingTop: 8 },
});
