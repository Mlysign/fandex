// Insights' "What you seek out": the tags, people, studios and franchises you
// pick far more often than an ordinary library holds, whatever you rated them
// (lib/seekOut.ts). Nils, 2026-11-26: "If I explain my taste I would say I
// love steampunk, and nothing on Fandex reflects this."
//
// A box per kind on one rail, its strongest rows, the rest in a sheet. A row
// is the name, the sentence ("23× more often than average") and how many you
// picked of the titles Fandex holds ("60 of 142"). Tapping it lists your own
// titles behind it in a rail under the boxes, which is also where its page is
// linked from (Nils, the same day: no bar, no "vs avg" column, picked against
// the catalog, tap for your titles).
//
// Deliberately without a number on the score's scale: beside the score, pull
// read as part of it (`PULL_SHOWN`, lib/scoreReasons.ts).
//
// ⚠️ This section and the three rating sections under it are due to become one
// facet section (your picks, your average and the score impact in one row),
// to be drawn with Nils on a design board first (TASKS.md). Until then, keep
// changes here small.

import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { keyToSlug } from '@/lib/facetUrl';
import { RailFrame } from '~/components/cardFace';
import { CardRail } from '~/components/cards';
import { Button, Eyebrow, Panel, Sheet, SortMenu } from '~/components/kit';
import { useAuth } from '~/lib/AuthProvider';
import { cardFromCatalog, type CardItem } from '~/lib/cards';
import { useCatalogSync } from '~/lib/CatalogSyncProvider';
import { catalogCardsById, pickStates } from '~/lib/db';
import { facetIndex, type FacetIndex } from '~/lib/related';
import { useScores } from '~/lib/ScoreProvider';
import { pullSentence, seekLine } from '~/lib/scoreReasons';
import { sortSeek, yourTitles, type SeekFacet, type SeekOrder } from '~/lib/seekOut';
import { useSeekOut } from '~/lib/SeekOutProvider';
import { color, font, radius, type } from '~/theme';

/** Rows a box shows; the rest open in a sheet. */
const PER_GROUP = 5;
/** At most this many of your titles in the rail a row opens; its page holds the rest. */
const MAX_YOURS = 120;

const ORDERS: [SeekOrder, string][] = [['weight', 'Strongest'], ['times', 'Furthest above average'], ['titles', 'Most titles']];

const KINDS: { kind: SeekFacet['kind']; label: string; tint: string }[] = [
  { kind: 'tag', label: 'Tags', tint: color.facet.tag },
  { kind: 'person', label: 'People', tint: color.facet.person },
  { kind: 'company', label: 'Studios', tint: color.facet.company },
  { kind: 'ip', label: 'Franchises', tint: color.facet.genre },
];

const ROLE_LABEL: Record<string, string> = {
  director: 'Director', writer: 'Writer', creator: 'Creator', cast: 'Cast',
  developer: 'Developer', publisher: 'Publisher', studio: 'Studio', network: 'Network',
};

/** Where a thing you seek out has its page. */
export const seekHref = (f: Pick<SeekFacet, 'kind' | 'key'>): string =>
  `/${f.kind === 'company' ? 'studio' : f.kind === 'ip' ? 'franchise' : f.kind}/${keyToSlug(f.key)}`;

/** How many Fandex holds of a facet, or null while that is not known yet. */
type CatalogCount = (f: SeekFacet) => number | null;

/**
 * One row: the name, the sentence under it, and how many you picked of the
 * titles Fandex holds. Tapping it lists your titles under the boxes.
 */
function SeekRow({ f, catalogCount, selected, onPress }: { f: SeekFacet; catalogCount: CatalogCount; selected: boolean; onPress: () => void }) {
  const role = f.role ? ROLE_LABEL[f.role] : null;
  const all = catalogCount(f);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${pullSentence(f, f.label)}${all ? `, of ${all} Fandex holds` : ''}. Show your titles.`}
      style={({ pressed }) => [styles.row, selected && styles.rowOn, pressed && { opacity: 0.6 }]}>
      <View style={styles.name}>
        <Text numberOfLines={1} style={[type.bodySm, { color: selected ? color.accent : color.textPrimary }]}>{f.label}</Text>
        <Text numberOfLines={1} style={type.caption}>{role ? `${role} · ` : ''}{seekLine(f.times)}</Text>
      </View>
      <Text numberOfLines={1} style={styles.count}>
        <Text style={styles.countMine}>{f.titles}</Text>{all ? ` of ${all}` : ''}
      </Text>
    </Pressable>
  );
}

/** One kind: its first rows, and every row in a sheet. */
function SeekBox({ label, rows, tint, catalogCount, selectedId, onSelect }: {
  label: string; rows: SeekFacet[]; tint: string; catalogCount: CatalogCount; selectedId: string | null; onSelect: (f: SeekFacet) => void;
}) {
  const [open, setOpen] = useState(false);
  const row = (f: SeekFacet, then?: () => void) => (
    <SeekRow key={f.id} f={f} catalogCount={catalogCount} selected={f.id === selectedId} onPress={() => { then?.(); onSelect(f); }} />
  );
  return (
    <Panel style={styles.box}>
      <View style={styles.boxHead}>
        <View style={[styles.dot, { backgroundColor: tint }]} />
        <Text numberOfLines={1} style={[type.bodySm, { flexShrink: 1, color: color.textPrimary }]}>{label}</Text>
        <Text style={[type.caption, { flex: 1 }]}>{rows.length}</Text>
        <Text style={styles.head}>You picked</Text>
      </View>
      {rows.slice(0, PER_GROUP).map((f) => row(f))}
      {rows.length > PER_GROUP ? (
        <Pressable onPress={() => setOpen(true)} accessibilityRole="button" hitSlop={8} style={({ pressed }) => [styles.more, pressed && { opacity: 0.6 }]}>
          <Text style={[type.caption, { color: color.accent }]}>Show all {rows.length}</Text>
        </Pressable>
      ) : null}
      <Sheet open={open} onClose={() => setOpen(false)} title={label}>
        <View style={styles.sheetHead}>
          <Text style={type.title}>{label}</Text>
          <Text style={[type.caption, { flex: 1 }]}>{rows.length}</Text>
          <Text style={styles.head}>You picked</Text>
        </View>
        {/* A row shows its titles under the boxes, so the sheet closes first or it would cover them. */}
        <ScrollView style={{ maxHeight: 560 }} contentContainerStyle={styles.sheetBody}>
          {rows.map((f) => row(f, () => setOpen(false)))}
        </ScrollView>
      </Sheet>
    </Panel>
  );
}

/** "with steampunk", "from Studio Ghibli", "in The Legend of Zelda". */
const withWhat = (f: SeekFacet) => `${f.kind === 'company' ? 'from' : f.kind === 'ip' ? 'in' : 'with'} ${f.label}`;

/** Your own titles behind the tapped row, and the way to its page. */
function YourTitles({ facet, items, onClear }: { facet: SeekFacet; items: CardItem[] | null; onClear: () => void }) {
  const router = useRouter();
  return (
    <Panel style={{ marginTop: 12, padding: 12 }}>
      <View style={styles.yoursHead}>
        <Text style={[type.bodySm, { flexShrink: 1 }]}>
          {items === null ? `Your titles ${withWhat(facet)}` : `${items.length}${items.length === MAX_YOURS ? '+' : ''} of your titles ${withWhat(facet)}`}
        </Text>
        <View style={styles.yoursActions}>
          <Pressable onPress={() => router.push(seekHref(facet) as never)} accessibilityRole="link" hitSlop={10}>
            <Text style={[type.bodySm, { color: color.accent }]}>Open its page</Text>
          </Pressable>
          <Pressable onPress={onClear} accessibilityRole="button" hitSlop={10}><Text style={type.bodySm}>Clear ✕</Text></Pressable>
        </View>
      </View>
      {items === null ? <View style={styles.note}><ActivityIndicator color={color.accent} /></View>
        : items.length ? <CardRail title="" items={items} />
        // The copy is refilling, or the title left your library a moment ago.
        : <Text style={[type.caption, { paddingVertical: 16 }]}>None of them is on this device right now.</Text>}
    </Panel>
  );
}

export function SeekOutSection({ boxWidth }: { boxWidth: number }) {
  const router = useRouter();
  const db = useSQLiteContext();
  const auth = useAuth();
  const catalog = useCatalogSync();
  const { taxonomy } = useScores();
  const seek = useSeekOut();
  const [order, setOrder] = useState<SeekOrder>('weight');
  const groups = useMemo(() => KINDS
    .map((k) => ({ ...k, rows: sortSeek(seek.facets.filter((f) => f.kind === k.kind), order) }))
    .filter((g) => g.rows.length), [seek.facets, order]);

  // Which titles carry a facet: the index the title pages' rails keep (lib/related.ts). A pass
  // over the whole catalog copy, so only while this screen is in front and there is a list to count for.
  const [focused, setFocused] = useState(false);
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));
  const [index, setIndex] = useState<FacetIndex | null>(null);
  const wantsIndex = focused && seek.facets.length > 0;
  useEffect(() => {
    let live = true;
    if (!wantsIndex || !taxonomy) return;
    facetIndex(db, catalog.revision, taxonomy)
      .then((built) => { if (live) setIndex(built); })
      .catch((e: unknown) => console.warn('fandex_seek_index_failed', e instanceof Error ? `${e.name}: ${e.message}` : String(e)));
    return () => { live = false; };
  }, [db, wantsIndex, taxonomy, catalog.revision]);
  // In the role the row's own count is of, so "60 of 142" compares like with like.
  const catalogCount = useCallback<CatalogCount>((f) => index?.byFacet.get(f.mainId)?.length ?? null, [index]);

  // The tapped row, and your titles behind it. A list that changed under it keeps the row while it is still listed.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(() => seek.facets.find((f) => f.id === selectedId) ?? null, [seek.facets, selectedId]);
  const [yours, setYours] = useState<{ id: string; items: CardItem[] } | null>(null);
  useEffect(() => {
    let live = true;
    if (!selected || !index) return;
    void (async () => {
      const picks = await pickStates(db);
      const ids = yourTitles(selected, (facetId) => (index.byFacet.get(facetId) ?? []).map((at) => index.ids[at]), picks).slice(0, MAX_YOURS);
      const cards = new Map((await catalogCardsById(db, ids)).map((r) => [r.id, cardFromCatalog(r)]));
      if (live) setYours({ id: selected.id, items: ids.map((id) => cards.get(id)).filter((c): c is CardItem => !!c) });
    })().catch((e: unknown) => console.warn('fandex_seek_titles_failed', e instanceof Error ? `${e.name}: ${e.message}` : String(e)));
    return () => { live = false; };
  }, [db, selected, index, auth.rowsRevision]);
  const select = useCallback((f: SeekFacet) => setSelectedId((cur) => (cur === f.id ? null : f.id)), []);

  if (seek.status === 'off') return null;
  const note = (text: string, busy = false) => (
    <View style={styles.note}>
      {busy ? <ActivityIndicator color={color.accent} /> : null}
      <Text style={[type.caption, { flexShrink: 1 }]}>{text}</Text>
    </View>
  );
  return (
    <View style={styles.section}>
      <Eyebrow>What you seek out</Eyebrow>
      <Text style={[type.caption, { marginTop: 4, marginBottom: 12 }]}>
        What you pick far more often than an ordinary library holds, whatever you rated it.
        {seek.status === 'ready' && seek.baseline
          ? ` Your ${seek.picks.toLocaleString('en')} titles, wishlist included, against ${seek.baseline.toLocaleString('en')} ordinary ones drawn at random.`
          : ''}
        {' '}Tap a row for your titles. This is not part of your Fandex Score, which goes by your ratings alone.
      </Text>
      {seek.status === 'idle' || seek.status === 'working' ? note('Working out what you seek out…', true)
        : seek.status === 'no-baseline' ? note('Fandex is still fetching the ordinary titles your picks are compared with. This fills in on its own.')
        : seek.status === 'no-picks' ? note('Nothing in your library or wishlist to compare yet.')
        : !groups.length ? note('Nothing stands out yet. It takes a few titles of one kind before Fandex calls it a habit, so this fills in as your library grows.')
        : (
          <>
            <View style={styles.metaRow}>
              <Text style={[type.micro, { color: color.accent, letterSpacing: 0.8 }]}>
                {`things you seek out · ${seek.facets.length}${seek.updating ? ' · updating…' : ''}`}
              </Text>
              <SortMenu value={order} options={ORDERS} onChange={setOrder} />
            </View>
            <RailFrame title="What you seek out" headless>
              {groups.map((g) => (
                <View key={g.kind} style={{ width: boxWidth }}>
                  <SeekBox label={g.label} rows={g.rows} tint={g.tint} catalogCount={catalogCount} selectedId={selectedId} onSelect={select} />
                </View>
              ))}
            </RailFrame>
            {selected ? <YourTitles facet={selected} items={yours?.id === selected.id ? yours.items : null} onClear={() => setSelectedId(null)} /> : null}
            <View style={{ flexDirection: 'row', marginTop: 12 }}>
              <Button label="See what these recommend" variant="secondary" size="md" onPress={() => router.push('/recommendations' as never)} />
            </View>
          </>
        )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 40 },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 30, marginBottom: 12 },
  note: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 24 },
  // Grows to the rail's tallest box, as Insights' rating boxes do.
  box: { flexGrow: 1, padding: 12, borderRadius: radius.xl },
  boxHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8, paddingHorizontal: 4 },
  dot: { width: 8, height: 8, borderRadius: radius.full },
  head: { textAlign: 'right', fontFamily: font.mono, fontSize: 8, lineHeight: 10, letterSpacing: 0.48, textTransform: 'uppercase', color: color.textSecondary },
  more: { alignSelf: 'flex-start', paddingTop: 6, paddingHorizontal: 4 },
  sheetHead: { flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingHorizontal: 18, paddingTop: 10 },
  sheetBody: { padding: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44, paddingHorizontal: 4, paddingVertical: 4, borderRadius: radius.sm },
  rowOn: { backgroundColor: color.fillIdle },
  name: { flex: 1, minWidth: 0 },
  count: { textAlign: 'right', fontFamily: font.mono, fontSize: 10, lineHeight: 14, color: color.textSecondary },
  countMine: { fontFamily: font.sansBold, fontSize: 12, color: color.textPrimary, fontVariant: ['tabular-nums'] },
  yoursHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 4 },
  yoursActions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
});
