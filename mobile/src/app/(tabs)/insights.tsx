// Insights: your taste in numbers. The site's page (src/components/insights/
// InsightsView.tsx), computed here from the rows on the device instead of asked
// of a server: the overview, how you rate, the spread per medium, taste by era,
// where you and the crowd disagree, how you rate tags, people and studios, and
// who turns up most.
//
// Every chart is built from what you have rated. The ranking of a tag, person or
// studio is the site's shrunk average (a facet seen twice does not outrank one
// seen forty times on the strength of two tens).
//
// Not carried over: the search and the minimum-count control in the three
// rating sections, and the per-category tag panels.

import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ChartColumn } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { keyToSlug } from '@/lib/facetUrl';
import { CardRail } from '~/components/cards';
import { Button, EmptyState, Eyebrow, Panel } from '~/components/kit';
import { SignIn } from '~/components/SignIn';
import { Screen } from '~/components/ui';
import { useAuth } from '~/lib/AuthProvider';
import type { CardItem } from '~/lib/cards';
import { useCatalogSync } from '~/lib/CatalogSyncProvider';
import { breakpoint, color, font, radius, type } from '~/theme';

interface Rated extends CardItem { rating: number; facets: StoredFacet[] }
interface StoredFacet { kind: string; key: string; label: string; role?: string; category?: string }
interface FacetStat { kind: string; role?: string; key: string; label: string; count: number; avg: number; ba: number }

/** How strongly a facet's average is pulled toward your own until it has been seen often (the site's C). */
const PRIOR_STRENGTH = 5;
/** A facet has to be on this many rated titles to be ranked at all. */
const MIN_COUNT = 3;

const facetHref = (f: FacetStat) => `/${f.kind === 'company' ? 'studio' : f.kind}/${keyToSlug(f.key)}`;
const tintOf = (f: FacetStat) => (f.kind === 'person' ? color.facet.person : f.kind === 'company' ? color.facet.company : color.facet.tag);

// ── Small parts ──────────────────────────────────────────────────────────────

function PanelHeader({ eyebrow, stat, hint }: { eyebrow: string; stat?: string; hint?: string }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <View style={styles.headRow}>
        <Eyebrow>{eyebrow}</Eyebrow>
        {stat ? <Text style={type.meta}>{stat}</Text> : null}
      </View>
      {hint ? <Text style={[type.caption, { marginTop: 4 }]}>{hint}</Text> : null}
    </View>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Panel style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={[type.bodySm, { marginTop: 2 }]}>{label}</Text>
      {sub ? <Text style={[type.caption, { marginTop: 2 }]}>{sub}</Text> : null}
    </Panel>
  );
}

/** Bars for a count per score. Tapping one picks it. */
function Histogram({ data, tint, height, selected, onPick }: {
  data: { bucket: number; count: number }[]; tint: string; height: number; selected?: number | null; onPick?: (bucket: number) => void;
}) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <View style={[styles.bars, { height }]}>
      {data.map((d) => {
        const dim = selected != null && selected !== d.bucket;
        return (
          <Pressable
            key={d.bucket}
            onPress={onPick && d.count ? () => onPick(d.bucket) : undefined}
            accessibilityRole={onPick ? 'button' : undefined}
            accessibilityLabel={`${d.count} rated ${d.bucket}`}
            style={styles.barCol}>
            <Text style={styles.barCount}>{d.count || ''}</Text>
            <View style={{ width: '100%', maxWidth: 48, height: `${(d.count / max) * 78}%`, minHeight: d.count ? 2 : 0, backgroundColor: tint, opacity: dim ? 0.3 : 0.85, borderTopLeftRadius: 4, borderTopRightRadius: 4 }} />
            <Text style={styles.barLabel}>{d.bucket}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** One facet as a row: its name, a bar for your average, the number, and how often. */
function StatBar({ f, baseline }: { f: FacetStat; baseline: number }) {
  const router = useRouter();
  return (
    <Pressable onPress={() => router.push(facetHref(f) as never)} accessibilityRole="link" style={({ pressed }) => [styles.statBar, pressed && { opacity: 0.6 }]}>
      <Text numberOfLines={1} style={[type.bodySm, { flex: 1, color: color.textPrimary }]}>{f.label}</Text>
      <View style={styles.track}>
        <View style={{ width: `${(f.avg / 10) * 100}%`, height: '100%', borderRadius: 3, backgroundColor: tintOf(f), opacity: f.avg >= baseline ? 0.9 : 0.45 }} />
      </View>
      <Text style={[styles.statBarValue, { color: f.avg >= baseline ? color.success : color.textSecondary }]}>{f.avg.toFixed(1)}</Text>
      <Text style={styles.statBarCount}>×{f.count}</Text>
    </Pressable>
  );
}

function FacetColumn({ title, facets, baseline, tone }: { title: string; facets: FacetStat[]; baseline: number; tone?: string }) {
  return (
    <Panel style={styles.column}>
      <Text style={[styles.columnTitle, tone ? { color: tone } : null]}>{title}</Text>
      {facets.length ? facets.map((f) => <StatBar key={`${f.kind}|${f.role ?? ''}|${f.key}`} f={f} baseline={baseline} />)
        : <Text style={[type.caption, { paddingVertical: 8 }]}>Not enough data.</Text>}
    </Panel>
  );
}

// ── The screen ───────────────────────────────────────────────────────────────

export default function InsightsScreen() {
  const router = useRouter();
  const db = useSQLiteContext();
  const auth = useAuth();
  const sync = useCatalogSync();
  const { width } = useWindowDimensions();
  const cols = width >= breakpoint.lg ? 4 : width >= breakpoint.sm ? 2 : 1;
  const [rated, setRated] = useState<Rated[] | null>(null);
  const [libraryTotal, setLibraryTotal] = useState(0);
  const [bucket, setBucket] = useState<number | null>(null);
  const [decade, setDecade] = useState<number | null>(null);

  const signedIn = auth.status === 'signedIn';
  useEffect(() => {
    let live = true;
    if (!signedIn) { setRated(null); return; }
    (async () => {
      const rows = await db.getAllAsync<{
        id: string; type: 'game' | 'movie' | 'show'; title: string; slug: string | null; poster_url: string | null;
        release_date: string | null; community_score: number | null; community_votes: number; facets: string; rating: number;
      }>(
        `SELECT c.id, c.type, c.title, c.slug, c.poster_url, c.release_date, c.community_score, c.community_votes, c.facets,
                AVG(s.rating) AS rating
           FROM item_state s JOIN catalog c ON c.id = s.media_item_id
          WHERE s.relation = 'library' AND s.rating > 0
          GROUP BY c.id`,
      );
      const total = await db.getFirstAsync<{ n: number }>(
        `SELECT COUNT(DISTINCT s.media_item_id) n FROM item_state s JOIN catalog c ON c.id = s.media_item_id WHERE s.relation = 'library'`,
      );
      if (!live) return;
      setLibraryTotal(total?.n ?? 0);
      setRated(rows.map((r) => {
        let facets: StoredFacet[] = [];
        try { facets = JSON.parse(r.facets) as StoredFacet[]; } catch { /* a title with no readable facets still counts as rated */ }
        return {
          key: r.id, id: r.id, type: r.type, title: r.title, slug: r.slug, posterUrl: r.poster_url, releaseDate: r.release_date,
          communityScore: r.community_score, communityVotes: r.community_votes, rating: r.rating, facets,
        };
      }));
    })();
    return () => { live = false; };
  }, [db, signedIn, auth.rowsRevision, sync.revision]);

  const data = useMemo(() => {
    if (!rated?.length) return null;
    const baseline = rated.reduce((a, r) => a + r.rating, 0) / rated.length;
    const hist = (list: Rated[]) => Array.from({ length: 10 }, (_, i) => ({ bucket: i + 1, count: list.filter((r) => Math.min(10, Math.max(1, Math.round(r.rating))) === i + 1).length }));
    const byType: Record<string, Rated[]> = { game: [], movie: [], show: [] };
    for (const r of rated) byType[r.type]?.push(r);

    const decades = new Map<number, { n: number; sum: number }>();
    for (const r of rated) {
      const y = Number(r.releaseDate?.slice(0, 4));
      if (!Number.isFinite(y) || y < 1900) continue;
      const d = Math.floor(y / 10) * 10;
      const cur = decades.get(d) ?? { n: 0, sum: 0 };
      cur.n++; cur.sum += r.rating;
      decades.set(d, cur);
    }

    // Against the crowd, on a 0 to 10 scale. Only titles with enough votes to call it a crowd.
    const diverging = rated.filter((r) => r.communityScore != null && (r.communityVotes ?? 0) >= 50)
      .map((r) => ({ r, delta: r.rating - (r.communityScore as number) / 10 }));
    const over = [...diverging].sort((a, b) => b.delta - a.delta).slice(0, 8);
    const under = [...diverging].sort((a, b) => a.delta - b.delta).slice(0, 8);

    const stats = new Map<string, { f: StoredFacet; n: number; sum: number }>();
    for (const r of rated) {
      const seen = new Set<string>();
      for (const f of r.facets) {
        if (f.kind !== 'tag' && f.kind !== 'person' && f.kind !== 'company') continue;
        const id = `${f.kind}|${f.role ?? ''}|${f.key}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const cur = stats.get(id) ?? { f, n: 0, sum: 0 };
        cur.n++; cur.sum += r.rating;
        stats.set(id, cur);
      }
    }
    const facets: FacetStat[] = [...stats.values()].map(({ f, n, sum }) => ({
      kind: f.kind, role: f.role, key: f.key, label: f.label, count: n, avg: sum / n,
      ba: (PRIOR_STRENGTH * baseline + sum) / (PRIOR_STRENGTH + n),
    }));
    const ranked = (kind: string) => facets.filter((f) => f.kind === kind && f.count >= MIN_COUNT);
    const top = (kind: string) => [...ranked(kind)].sort((a, b) => b.ba - a.ba).slice(0, 8);
    const bottom = (kind: string) => [...ranked(kind)].sort((a, b) => a.ba - b.ba).slice(0, 8);
    const most = (kind: string, ...roles: string[]) => facets.filter((f) => f.kind === kind && roles.includes(f.role ?? ''))
      .sort((a, b) => b.count - a.count || b.avg - a.avg).slice(0, 8);

    return {
      baseline, histogram: hist(rated),
      byType: Object.entries(byType).filter(([, l]) => l.length).map(([t, l]) => ({ type: t, count: l.length, histogram: hist(l) })),
      decades: [...decades.entries()].sort(([a], [b]) => a - b).map(([d, v]) => ({ decade: d, count: v.n, avg: v.sum / v.n })),
      over, under,
      sections: [
        { title: 'Tag ratings', hint: 'How you rate every genre, theme and keyword in your rated library.', kind: 'tag' },
        { title: 'People ratings', hint: 'How you rate the directors, writers, creators and cast behind what you have watched.', kind: 'person' },
        { title: 'Studio ratings', hint: 'Developers, publishers, film studios and TV networks, ranked by how you rate their work.', kind: 'company' },
      ].map((s) => ({ ...s, top: top(s.kind), bottom: bottom(s.kind) })),
      mostWatched: [
        { title: 'Actors', facets: most('person', 'cast') },
        { title: 'Directors', facets: most('person', 'director') },
        { title: 'Film studios', facets: most('company', 'studio') },
        { title: 'Game studios', facets: most('company', 'developer', 'publisher') },
      ],
    };
  }, [rated]);

  const picked = useMemo(() => {
    if (!rated) return [];
    if (bucket != null) return rated.filter((r) => Math.min(10, Math.max(1, Math.round(r.rating))) === bucket).sort((a, b) => b.rating - a.rating);
    if (decade != null) return rated.filter((r) => Math.floor(Number(r.releaseDate?.slice(0, 4)) / 10) * 10 === decade).sort((a, b) => b.rating - a.rating);
    return [];
  }, [rated, bucket, decade]);

  const head = (
    <View style={{ marginBottom: 24 }}>
      <Eyebrow>Your taste, in numbers</Eyebrow>
      <Text accessibilityRole="header" style={[type.serifXl, { marginTop: 4 }]}>Insights</Text>
    </View>
  );

  if (auth.status === 'signedOut') {
    return (
      <Screen wide>
        <ScrollView contentContainerStyle={styles.main}>
          {head}
          <SignIn title="Sign in to see your Insights" hint="Every chart here is built from what you have rated. Sign in with Trakt and your taste profile fills itself in." />
        </ScrollView>
      </Screen>
    );
  }
  if (rated === null) {
    return <Screen wide><View style={styles.main}>{head}<ActivityIndicator color={color.accent} /></View></Screen>;
  }
  // Still arriving is not the same as none: a fresh tab has to fetch your rows and the catalog first.
  if (!data && (auth.rowsSyncing || sync.state === 'syncing')) {
    return <Screen wide><View style={styles.main}>{head}<ActivityIndicator color={color.accent} /></View></Screen>;
  }
  if (!data) {
    return (
      <Screen wide>
        <View style={styles.main}>
          {head}
          <EmptyState
            icon={<ChartColumn size={20} color={color.accent} />}
            title="No rated items in your library yet"
            hint="Rate a few games, movies or shows, then come back. Every chart here is built from your ratings."
            actions={<Button label="Go to Library" variant="secondary" size="md" onPress={() => router.push('/wishlist?tab=library' as never)} />}
          />
        </View>
      </Screen>
    );
  }

  const grid = (n: number) => ({ width: `${100 / n}%` as const });
  return (
    <Screen wide>
      <ScrollView contentContainerStyle={styles.main}>
        {head}

        <View style={styles.section}>
          <PanelHeader eyebrow="Overview" hint={`Scored against your ${data.baseline.toFixed(1)}/10 average.`} />
          <View style={styles.wrap}>
            {[
              <Stat key="r" label="Rated items" value={String(rated.length)} sub={`${libraryTotal} in library`} />,
              <Stat key="a" label="Average" value={data.baseline.toFixed(1)} sub="your mean rating" />,
              ...data.byType.map((t) => <Stat key={t.type} label={`${t.type[0].toUpperCase()}${t.type.slice(1)}s`} value={String(t.count)} />),
            ].map((el, i) => <View key={i} style={[styles.cell, grid(width >= breakpoint.lg ? 5 : width >= breakpoint.sm ? 3 : 2)]}>{el}</View>)}
          </View>
        </View>

        <View style={styles.section}>
          <Panel style={{ padding: 16 }}>
            <PanelHeader eyebrow="How you rate" stat={`avg ${data.baseline.toFixed(1)} · ${rated.length} rated`} hint="How many of your ratings fall at each score. Tap a bar to list those titles." />
            <Histogram data={data.histogram} tint={color.media.show} height={160} selected={bucket} onPick={(b) => { setDecade(null); setBucket((cur) => (cur === b ? null : b)); }} />
          </Panel>
          {bucket != null && picked.length ? <Picked label={`${picked.length} rated ${bucket}`} items={picked} onClear={() => setBucket(null)} /> : null}
        </View>

        <View style={styles.section}>
          <PanelHeader eyebrow="Distribution by type" hint="Your score distribution per medium. Do you rate games like you rate films?" />
          <View style={styles.wrap}>
            {data.byType.map((t) => (
              <View key={t.type} style={[styles.cell, grid(width >= breakpoint.sm ? 3 : 1)]}>
                <Panel style={{ padding: 12 }}>
                  <View style={styles.typeHead}>
                    <View style={[styles.dot, { backgroundColor: color.media[t.type] }]} />
                    <Text style={[type.label, { textTransform: 'capitalize' }]}>{t.type}s</Text>
                  </View>
                  <Histogram data={t.histogram} tint={color.media[t.type]} height={110} />
                </Panel>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <PanelHeader eyebrow="Taste by era" hint="Average rating you gave by release decade. Tap a bar to list those titles." />
          <Panel style={{ padding: 16 }}>
            <View style={[styles.bars, { height: 160 }]}>
              {data.decades.map((d) => (
                <Pressable key={d.decade} onPress={() => { setBucket(null); setDecade((cur) => (cur === d.decade ? null : d.decade)); }} accessibilityRole="button" accessibilityLabel={`${d.decade}s, average ${d.avg.toFixed(1)} over ${d.count}`} style={styles.barCol}>
                  <Text style={styles.barCount}>{d.avg.toFixed(1)}</Text>
                  <View style={{ width: '100%', maxWidth: 48, height: `${(d.avg / 10) * 70}%`, backgroundColor: d.avg >= data.baseline ? color.success : color.neutral600, opacity: decade != null && decade !== d.decade ? 0.3 : 0.85, borderTopLeftRadius: 4, borderTopRightRadius: 4 }} />
                  <Text style={styles.barLabel}>{d.decade}s</Text>
                  <Text style={[styles.barLabel, { fontSize: 9 }]}>×{d.count}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={[type.caption, { marginTop: 8 }]}>Green = above your {data.baseline.toFixed(1)} average.</Text>
          </Panel>
          {decade != null && picked.length ? <Picked label={`${picked.length} from the ${decade}s`} items={picked} onClear={() => setDecade(null)} /> : null}
        </View>

        <View style={styles.section}>
          <PanelHeader eyebrow="You vs the crowd" hint="Where your ratings most diverge from the crowd (both shown on a 0-10 scale)." />
          <View style={styles.wrap}>
            {[{ title: 'You rate higher', tone: color.success, list: data.over }, { title: 'You rate lower', tone: color.danger, list: data.under }].map((side) => (
              <View key={side.title} style={[styles.cell, grid(width >= breakpoint.sm ? 2 : 1)]}>
                <Panel style={styles.column}>
                  <Text style={[styles.columnTitle, { color: side.tone }]}>{side.title}</Text>
                  {side.list.map(({ r, delta }) => (
                    <Pressable key={r.key} onPress={() => router.push(`/item/${r.id}` as never)} accessibilityRole="link" style={({ pressed }) => [styles.statBar, pressed && { opacity: 0.6 }]}>
                      <Text numberOfLines={1} style={[type.bodySm, { flex: 1, color: color.textPrimary }]}>{r.title}</Text>
                      <Text style={styles.statBarCount}>you {r.rating.toFixed(1)} · crowd {((r.communityScore as number) / 10).toFixed(1)}</Text>
                      <Text style={[styles.statBarValue, { width: 40, color: delta >= 0 ? color.success : color.danger }]}>{delta >= 0 ? '+' : ''}{delta.toFixed(1)}</Text>
                    </Pressable>
                  ))}
                </Panel>
              </View>
            ))}
          </View>
        </View>

        {data.sections.map((s) => (
          <View key={s.kind} style={styles.section}>
            <PanelHeader eyebrow={s.title} hint={s.hint} />
            <View style={styles.wrap}>
              <View style={[styles.cell, grid(width >= breakpoint.sm ? 2 : 1)]}><FacetColumn title="Highest" tone={color.success} facets={s.top} baseline={data.baseline} /></View>
              <View style={[styles.cell, grid(width >= breakpoint.sm ? 2 : 1)]}><FacetColumn title="Lowest" tone={color.danger} facets={s.bottom} baseline={data.baseline} /></View>
            </View>
          </View>
        ))}

        <View style={styles.section}>
          <PanelHeader eyebrow="Most watched" hint="Who appears most often across your rated library: actors and directors, film and game studios." />
          <View style={styles.wrap}>
            {data.mostWatched.map((c) => (
              <View key={c.title} style={[styles.cell, grid(cols === 1 ? 1 : cols === 2 ? 2 : 4)]}><FacetColumn title={c.title} facets={c.facets} baseline={data.baseline} /></View>
            ))}
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}

/** The titles behind a tapped bar. */
function Picked({ label, items, onClear }: { label: string; items: CardItem[]; onClear: () => void }) {
  return (
    <Panel style={{ marginTop: 12, padding: 12 }}>
      <View style={[styles.headRow, { marginBottom: 4 }]}>
        <Text style={type.bodySm}>{label}</Text>
        <Pressable onPress={onClear} accessibilityRole="button" hitSlop={14}><Text style={type.bodySm}>Clear ✕</Text></Pressable>
      </View>
      <CardRail title="" items={items.slice(0, 40)} />
    </Panel>
  );
}

const styles = StyleSheet.create({
  // max-w-6xl, px-6, py-6
  main: { width: '100%', maxWidth: 1152, alignSelf: 'center', paddingHorizontal: 24, paddingVertical: 24 },
  section: { marginBottom: 40 },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  // A wrapping grid with a 12 px gutter: each cell pads half of it.
  wrap: { flexDirection: 'row', flexWrap: 'wrap', margin: -6 },
  cell: { padding: 6 },
  stat: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: radius.xl },
  statValue: { fontFamily: font.sansBold, fontSize: 24, lineHeight: 30, color: color.textPrimary, fontVariant: ['tabular-nums'] },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  barCol: { flex: 1, minWidth: 0, height: '100%', alignItems: 'center', justifyContent: 'flex-end' },
  barCount: { fontFamily: font.mono, fontSize: 10, lineHeight: 12, color: color.textSecondary, marginBottom: 2 },
  barLabel: { fontFamily: font.mono, fontSize: 10, lineHeight: 12, color: color.textSecondary, marginTop: 4 },
  typeHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  dot: { width: 8, height: 8, borderRadius: radius.full },
  column: { padding: 12, borderRadius: radius.xl },
  columnTitle: { fontFamily: font.mono, fontSize: 11, lineHeight: 14, letterSpacing: 0.5, textTransform: 'uppercase', color: color.textSecondary, marginBottom: 6 },
  statBar: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 30, paddingHorizontal: 4 },
  track: { width: 64, height: 6, borderRadius: 3, backgroundColor: color.surfaceInset, overflow: 'hidden' },
  statBarValue: { width: 28, textAlign: 'right', fontFamily: font.sansBold, fontSize: 12, lineHeight: 15, fontVariant: ['tabular-nums'] },
  statBarCount: { fontFamily: font.mono, fontSize: 10, lineHeight: 12, color: color.textSecondary },
});
