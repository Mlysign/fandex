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
// The three rating sections are the site's FacetSection, with the grid
// screens' search and sort: a box per tag category (the live list, so a
// category added on /dev/scoring shows up) or per role, its four strongest
// rows and what each does to your Fandex Score, the rest in a sheet.
//
// No chart wears a medium's colour unless it is about that medium (Nils, Miro
// board, 2026-11-05): purple read as Shows, green as Games.

import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ChartColumn, Check, ChevronDown } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { keyToSlug } from '@/lib/facetUrl';
import { CardRail } from '~/components/cards';
import { Button, EmptyState, Eyebrow, Panel, Popover, SearchBar, Sheet, SortMenu, useAnchor } from '~/components/kit';
import { TypeIcon } from '~/components/Logo';
import { SignIn } from '~/components/SignIn';
import { Screen } from '~/components/ui';
import { usePageTitle } from '~/lib/pageTitle';
import { useAuth } from '~/lib/AuthProvider';
import type { CardItem } from '~/lib/cards';
import { useCatalogSync } from '~/lib/CatalogSyncProvider';
import type { Taxonomy } from '~/lib/fandexScore';
import { impactId, useFacetImpacts } from '~/lib/insightsImpacts';
import { useScores } from '~/lib/ScoreProvider';
import { signed } from '~/lib/scoreReasons';
import { breakpoint, color, font, radius, type, TYPE_PLURAL } from '~/theme';
import { MEDIA_TYPES } from '@/lib/mediaTypes';
import type { MediaType } from '~/lib/api';

interface Rated extends CardItem { rating: number; facets: StoredFacet[] }
interface StoredFacet { kind: string; key: string; label: string; role?: string; category?: string }
interface FacetStat { kind: string; role?: string; key: string; label: string; category?: string; count: number; avg: number; ba: number }

/** How strongly a facet's average is pulled toward your own until it has been seen often (the site's C). */
const PRIOR_STRENGTH = 5;

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

/**
 * The overview as one row (Nils, Miro board: the tiles took a lot of space).
 * A medium's cell is its icon over the count; it scrolls sideways where a
 * phone has no room for every medium.
 */
function OverviewStrip({ cells }: { cells: { key: string; value: string; label: string; icon?: string }[] }) {
  return (
    <Panel style={{ overflow: 'hidden' }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1 }}>
        {cells.map((c, i) => (
          <View key={c.key} accessible accessibilityLabel={`${c.label}: ${c.value}`} style={[styles.overviewCell, i > 0 && { borderLeftWidth: 1, borderLeftColor: color.border }]}>
            <Text style={styles.overviewValue}>{c.value}</Text>
            {c.icon
              ? <View style={styles.overviewIcon}><TypeIcon type={c.icon} size={14} tint={color.media[c.icon] ?? color.textSecondary} /></View>
              : <Text numberOfLines={1} style={[type.meta, { marginTop: 2 }]}>{c.label}</Text>}
          </View>
        ))}
      </ScrollView>
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

/** What a facet does to your score, as FacetScreen colours it. Not a medium's colour. */
const IMPACT_TONE = {
  up: { backgroundColor: color.successSubtle, color: color.success },
  down: { backgroundColor: color.dangerSubtle, color: color.danger },
  neutral: { backgroundColor: color.surfaceInset, color: color.textSecondary },
} as const;

/** Undefined: no impact column. 'pending': still being worked out. Null: the score does not weigh it. */
type ImpactCell = number | null | 'pending' | undefined;

/**
 * One facet as a row: its name, a bar for your average, the number, how often,
 * and what it does to your score. Everything right of the name is a fixed
 * width, so every bar in a box starts on the same line.
 */
function StatBar({ f, baseline, impact, onNavigate }: { f: FacetStat; baseline: number; impact?: ImpactCell; onNavigate?: () => void }) {
  const router = useRouter();
  const tone = typeof impact === 'number' ? IMPACT_TONE[Math.abs(impact) < 0.5 ? 'neutral' : impact > 0 ? 'up' : 'down'] : null;
  return (
    <Pressable
      onPress={() => { onNavigate?.(); router.push(facetHref(f) as never); }}
      accessibilityRole="link"
      accessibilityLabel={`${f.label}, you rate it ${f.avg.toFixed(1)} over ${f.count}${typeof impact === 'number' ? `, Fandex Score ${signed(impact)}` : ''}`}
      style={({ pressed }) => [styles.statBar, pressed && { opacity: 0.6 }]}>
      <Text numberOfLines={1} style={[type.bodySm, { flex: 1, minWidth: 0, color: color.textPrimary }]}>{f.label}</Text>
      <View style={styles.track}>
        <View style={{ width: `${(f.avg / 10) * 100}%`, height: '100%', borderRadius: 3, backgroundColor: tintOf(f), opacity: f.avg >= baseline ? 0.9 : 0.45 }} />
      </View>
      <Text style={[styles.statBarValue, { color: f.avg >= baseline ? color.accent : color.textSecondary }]}>{f.avg.toFixed(1)}</Text>
      <Text numberOfLines={1} style={styles.statBarCount}>×{f.count}</Text>
      {impact === undefined ? null : (
        <Text style={[styles.impact, tone ?? { color: color.textMuted }]}>
          {typeof impact === 'number' ? signed(impact) : impact === 'pending' ? '…' : '-'}
        </Text>
      )}
    </Pressable>
  );
}

// ── The rating sections (the site's FacetSection) ─────────────────────────────

const PERSON_ROLES: [string, string][] = [['director', 'Director'], ['writer', 'Writer'], ['creator', 'Creator'], ['cast', 'Cast']];
const COMPANY_ROLES: [string, string][] = [['developer', 'Developer'], ['publisher', 'Publisher'], ['studio', 'Studio'], ['network', 'Network']];
/** Rows a box shows; the rest open in a sheet (Nils, Miro board: at most four). */
const PER_GROUP = 4;
const MIN_COUNTS = [1, 2, 3, 5, 10];
/** What a rating box opens on: on 5+ titles, sorted Highest (Nils, 2026-11-05). */
const DEFAULT_MIN_COUNT = 5;
const DEFAULT_ORDER = 'top' satisfies Order;

type Order = 'impact' | 'top' | 'bottom' | 'picked';
// "Most picked": on the most of your rated titles, which "Most watched" used to list (Nils, 2026-11-05).
const ORDERS: [Order, string][] = [['top', 'Highest'], ['bottom', 'Lowest'], ['picked', 'Most picked'], ['impact', 'Score impact']];

type Impacts = ReadonlyMap<string, number | null> | null;
const impactCell = (f: FacetStat, impacts: Impacts): ImpactCell => (impacts ? impacts.get(impactId(f)) ?? null : 'pending');

/** By impact: the biggest effect either way first, and what the score does not weigh last. */
function sortFacets(list: FacetStat[], order: Order, impacts: Impacts): FacetStat[] {
  if (order === 'picked') return [...list].sort((a, b) => b.count - a.count || b.avg - a.avg);
  // By the average the row shows, not the smoothed `ba` behind it: feudal japan at 8.8 sat under
  // Post-apocalyptic at 8.0 because `ba` leans few titles toward your overall average (Nils, 2026-11-05).
  // The minimum count (5+ by default) keeps one lucky title from topping the list.
  if (order !== 'impact') return [...list].sort((a, b) => (order === 'top' ? b.avg - a.avg : a.avg - b.avg) || b.count - a.count);
  const at = (f: FacetStat) => impacts?.get(impactId(f)) ?? null;
  return [...list].sort((a, b) => {
    const x = at(a);
    const y = at(b);
    if (x == null || y == null) return x == null && y == null ? b.count - a.count : x == null ? 1 : -1;
    return Math.abs(y) - Math.abs(x) || b.count - a.count;
  });
}

/** The minimum count, drawn as the sort menu is, so the two read as one row of controls. */
function MinCountMenu({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const a = useAnchor();
  const label = (n: number) => `On ${n}+ titles`;
  return (
    <>
      <Pressable
        ref={a.ref}
        onPress={a.open}
        accessibilityRole="button"
        accessibilityLabel={`Show what is ${label(value).toLowerCase()}`}
        accessibilityState={{ expanded: a.isOpen }}
        hitSlop={{ top: 14, bottom: 14 }}
        style={styles.menuTrigger}>
        <Text style={type.meta}>{label(value)}</Text>
        <ChevronDown size={14} color={color.textSecondary} />
      </Pressable>
      <Popover anchor={a.anchor} width={180} align="right" onClose={a.close} estimatedHeight={MIN_COUNTS.length * 44 + 8}>
        {MIN_COUNTS.map((n) => (
          <Pressable
            key={n}
            onPress={() => { onChange(n); a.close(); }}
            accessibilityRole="menuitem"
            accessibilityState={{ selected: n === value }}
            style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [styles.menuItem, (pressed || hovered) && { backgroundColor: color.fillIdle }]}>
            <Check size={14} color={color.accent} style={{ opacity: n === value ? 1 : 0 }} />
            <Text style={[type.bodySm, { color: color.textPrimary, flex: 1 }]}>{label(n)}</Text>
          </Pressable>
        ))}
      </Popover>
    </>
  );
}

/** One category or role: its first rows, and every row in a sheet. */
function FacetBox({ label, rows, baseline, impacts, tint }: { label: string; rows: FacetStat[]; baseline: number; impacts: Impacts; tint: string }) {
  const [open, setOpen] = useState(false);
  const row = (f: FacetStat, onNavigate?: () => void) => (
    <StatBar key={impactId(f)} f={f} baseline={baseline} impact={impactCell(f, impacts)} onNavigate={onNavigate} />
  );
  return (
    <Panel style={styles.column}>
      <View style={styles.groupHead}>
        <View style={[styles.dot, { backgroundColor: tint }]} />
        <Text numberOfLines={1} style={[type.bodySm, { flexShrink: 1, color: color.textPrimary }]}>{label}</Text>
        <Text style={[type.caption, { flex: 1 }]}>{rows.length}</Text>
        <Text style={styles.impactHead}>Taste</Text>
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
          <Text style={type.caption}>{rows.length}</Text>
          <Text style={[styles.impactHead, { marginLeft: 'auto' }]}>Taste</Text>
        </View>
        {/* A row opens its page, so the sheet closes first or it would cover that page. */}
        <ScrollView style={{ maxHeight: 560 }} contentContainerStyle={styles.sheetBody}>
          {rows.map((f) => row(f, () => setOpen(false)))}
        </ScrollView>
      </Sheet>
    </Panel>
  );
}

function FacetRatings({ kind, title, hint, facets, baseline, taxonomy, cols }: {
  kind: 'tag' | 'person' | 'company'; title: string; hint: string; facets: FacetStat[]; baseline: number; taxonomy: Taxonomy | null; cols: number;
}) {
  const { tasteIndex } = useScores();
  const [query, setQuery] = useState('');
  const [minCount, setMinCount] = useState(DEFAULT_MIN_COUNT);
  const [order, setOrder] = useState<Order>(DEFAULT_ORDER);
  const noun = kind === 'company' ? 'studios' : kind === 'person' ? 'people' : 'tags';
  const ofKind = useMemo(() => facets.filter((f) => f.kind === kind), [facets, kind]);
  const q = query.trim().toLowerCase();
  const found = useMemo(() => (q
    ? ofKind.filter((f) => f.label.toLowerCase().includes(q)).sort((a, b) => b.count - a.count || b.ba - a.ba).slice(0, 50)
    : []), [ofKind, q]);
  const eligible = useMemo(() => {
    const list: { id: string; label: string; facets: FacetStat[] }[] = kind === 'tag'
      // The live category list, in its own order. An ignored category (noise, platforms) is left out, as the score leaves it out.
      ? [...(taxonomy?.categories ?? new Map<string, { label: string; weight: number; ignored: boolean }>()).entries()]
          .filter(([, c]) => !c.ignored && c.weight !== 0)
          .map(([id, c]) => ({ id, label: c.label, facets: ofKind.filter((f) => (f.category ?? 'other') === id) }))
      : (kind === 'person' ? PERSON_ROLES : COMPANY_ROLES).map(([id, label]) => ({ id, label, facets: ofKind.filter((f) => f.role === id) }));
    return list.map((g) => ({ ...g, facets: g.facets.filter((f) => f.count >= minCount) })).filter((g) => g.facets.length);
  }, [ofKind, kind, taxonomy, minCount]);
  // Only what can be shown is weighed: the boxes at this minimum, or the search's matches.
  const targets = useMemo(() => (q ? found : eligible.flatMap((g) => g.facets)), [q, found, eligible]);
  const impacts = useFacetImpacts(targets, tasteIndex, taxonomy);
  const groups = useMemo(() => eligible.map((g) => ({ ...g, sorted: sortFacets(g.facets, order, impacts) })), [eligible, order, impacts]);
  const total = eligible.reduce((n, g) => n + g.facets.length, 0);

  return (
    <View style={styles.section}>
      <Eyebrow>{title}</Eyebrow>
      <Text style={[type.caption, { marginTop: 4, marginBottom: 12 }]}>{hint}</Text>
      {/* The grid screens' search and sort line (SubBar), so the controls read the same everywhere. */}
      <SearchBar value={query} onChange={setQuery} placeholder={`Search ${noun}…`} />
      <View style={styles.metaRow}>
        <Text style={[type.micro, { color: color.accent, letterSpacing: 0.8 }]}>{q ? `Matches · ${found.length}` : `${noun} · ${total}`}</Text>
        {!q ? (
          <View style={styles.metaRight}>
            <MinCountMenu value={minCount} onChange={setMinCount} />
            <SortMenu value={order} options={ORDERS} onChange={setOrder} />
          </View>
        ) : null}
      </View>
      {q ? (
        found.length
          ? <Panel style={styles.column}>{found.map((f) => <StatBar key={impactId(f)} f={f} baseline={baseline} impact={impactCell(f, impacts)} />)}</Panel>
          : <Text style={[type.bodySm, { textAlign: 'center', paddingVertical: 24 }]}>No matches for “{query}”.</Text>
      ) : !groups.length ? (
        <Text style={[type.bodySm, { textAlign: 'center', paddingVertical: 24 }]}>None of your {noun} is on {minCount} or more rated titles yet.</Text>
      ) : !impacts ? (
        // No taste profile on the device yet (a fresh start reads your library first). Said with a spinner,
        // never a faint "…" per cell: Nils could not tell whether the page had loaded (2026-11-05).
        <View style={styles.weighing}>
          <ActivityIndicator color={color.accent} />
          <Text style={type.caption}>Reading your taste profile…</Text>
        </View>
      ) : (
        <View style={styles.wrap}>
          {groups.map((g) => (
            <View key={g.id} style={[styles.cell, { width: `${100 / cols}%` as const }]}>
              <FacetBox label={g.label} rows={g.sorted} baseline={baseline} impacts={impacts} tint={tintOf({ kind } as FacetStat)} />
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ── The screen ───────────────────────────────────────────────────────────────

export default function InsightsScreen() {
  usePageTitle('Insights');
  const router = useRouter();
  const db = useSQLiteContext();
  const auth = useAuth();
  const sync = useCatalogSync();
  const { width } = useWindowDimensions();
  const [rated, setRated] = useState<Rated[] | null>(null);
  const [libraryTotal, setLibraryTotal] = useState(0);
  const [bucket, setBucket] = useState<number | null>(null);
  const [decade, setDecade] = useState<number | null>(null);
  // A bar on one medium's chart: the other charts' picks clear, as the two above clear each other.
  const [typeBucket, setTypeBucket] = useState<{ type: string; bucket: number } | null>(null);
  const { taxonomy } = useScores();

  const signedIn = auth.status === 'signedIn';
  useEffect(() => {
    let live = true;
    if (!signedIn) { setRated(null); return; }
    (async () => {
      const rows = await db.getAllAsync<{
        id: string; type: MediaType; title: string; slug: string | null; poster_url: string | null;
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
    const byType: Record<string, Rated[]> = Object.fromEntries(MEDIA_TYPES.map((t) => [t, [] as Rated[]]));
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
      category: f.kind === 'tag' ? (taxonomy?.tagCategoryOverrides.get(f.key) ?? f.category ?? 'other') : undefined,
      ba: (PRIOR_STRENGTH * baseline + sum) / (PRIOR_STRENGTH + n),
    }));

    return {
      baseline, histogram: hist(rated),
      byType: Object.entries(byType).filter(([, l]) => l.length).map(([t, l]) => ({ type: t, count: l.length, histogram: hist(l) })),
      decades: [...decades.entries()].sort(([a], [b]) => a - b).map(([d, v]) => ({ decade: d, count: v.n, avg: v.sum / v.n })),
      sections: [
        { title: 'Tag ratings', hint: 'How you rate every genre, theme and keyword in your rated library.', kind: 'tag' },
        { title: 'People ratings', hint: 'How you rate the directors, writers, creators and cast behind what you have watched.', kind: 'person' },
        { title: 'Studio ratings', hint: 'Developers, publishers, film studios and TV networks, ranked by how you rate their work.', kind: 'company' },
      ],
      facets,
    };
  }, [rated, taxonomy]);

  const picked = useMemo(() => {
    if (!rated) return [];
    if (bucket != null) return rated.filter((r) => Math.min(10, Math.max(1, Math.round(r.rating))) === bucket).sort((a, b) => b.rating - a.rating);
    if (decade != null) return rated.filter((r) => Math.floor(Number(r.releaseDate?.slice(0, 4)) / 10) * 10 === decade).sort((a, b) => b.rating - a.rating);
    if (typeBucket) return rated.filter((r) => r.type === typeBucket.type && Math.min(10, Math.max(1, Math.round(r.rating))) === typeBucket.bucket).sort((a, b) => b.rating - a.rating);
    return [];
  }, [rated, bucket, decade, typeBucket]);

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
          <PanelHeader eyebrow="Overview" stat={`${libraryTotal} in library`} hint={`Scored against your ${data.baseline.toFixed(1)}/10 average.`} />
          <OverviewStrip cells={[
            { key: 'r', value: String(rated.length), label: 'rated' },
            { key: 'a', value: data.baseline.toFixed(1), label: 'average' },
            ...data.byType.map((t) => ({ key: t.type, value: String(t.count), label: TYPE_PLURAL[t.type] ?? t.type, icon: t.type })),
          ]} />
        </View>

        <View style={styles.section}>
          <Panel style={{ padding: 16 }}>
            <PanelHeader eyebrow="How you rate" stat={`avg ${data.baseline.toFixed(1)} · ${rated.length} rated`} hint="How many of your ratings fall at each score. Tap a bar to list those titles." />
            <Histogram data={data.histogram} tint={color.accent} height={160} selected={bucket} onPick={(b) => { setDecade(null); setTypeBucket(null); setBucket((cur) => (cur === b ? null : b)); }} />
          </Panel>
          {bucket != null && picked.length ? <Picked label={`${picked.length} rated ${bucket}`} items={picked} onClear={() => setBucket(null)} /> : null}
        </View>

        <View style={styles.section}>
          <PanelHeader eyebrow="Distribution by type" hint="Your score distribution per medium. Do you rate games like you rate films? Tap a bar to list those titles." />
          <View style={styles.wrap}>
            {data.byType.map((t) => (
              <View key={t.type} style={[styles.cell, grid(width >= breakpoint.sm ? 3 : 1)]}>
                <Panel style={{ padding: 12 }}>
                  <View style={styles.typeHead}>
                    <TypeIcon type={t.type} size={14} tint={color.media[t.type]} />
                    <Text style={type.label}>{TYPE_PLURAL[t.type] ?? t.type}</Text>
                  </View>
                  <Histogram
                    data={t.histogram} tint={color.media[t.type]} height={110}
                    selected={typeBucket?.type === t.type ? typeBucket.bucket : null}
                    onPick={(b) => {
                      setBucket(null); setDecade(null);
                      setTypeBucket((cur) => (cur?.type === t.type && cur.bucket === b ? null : { type: t.type, bucket: b }));
                    }}
                  />
                </Panel>
              </View>
            ))}
          </View>
          {typeBucket && picked.length
            ? <Picked label={`${picked.length} ${(TYPE_PLURAL[typeBucket.type] ?? typeBucket.type).toLowerCase()} rated ${typeBucket.bucket}`} items={picked} onClear={() => setTypeBucket(null)} />
            : null}
        </View>

        <View style={styles.section}>
          <PanelHeader eyebrow="Taste by era" hint="Average rating you gave by release decade. Tap a bar to list those titles." />
          <Panel style={{ padding: 16 }}>
            {/* A rail of fixed-width decades: squeezed into the panel's width, "1900s" broke over two lines (Nils, Miro board). */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.bars, styles.eraRail]}>
              {data.decades.map((d) => (
                <Pressable key={d.decade} onPress={() => { setBucket(null); setTypeBucket(null); setDecade((cur) => (cur === d.decade ? null : d.decade)); }} accessibilityRole="button" accessibilityLabel={`${d.decade}s, average ${d.avg.toFixed(1)} over ${d.count}`} style={styles.eraCol}>
                  <Text style={styles.barCount}>{d.avg.toFixed(1)}</Text>
                  <View style={{ width: '100%', height: `${(d.avg / 10) * 70}%`, backgroundColor: d.avg >= data.baseline ? color.accent : color.neutral600, opacity: decade != null && decade !== d.decade ? 0.3 : 0.85, borderTopLeftRadius: 4, borderTopRightRadius: 4 }} />
                  <Text numberOfLines={1} style={styles.barLabel}>{d.decade}s</Text>
                  <Text numberOfLines={1} style={[styles.barLabel, { fontSize: 9 }]}>×{d.count}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Text style={[type.caption, { marginTop: 8 }]}>Gold = above your {data.baseline.toFixed(1)} average.</Text>
          </Panel>
          {decade != null && picked.length ? <Picked label={`${picked.length} from the ${decade}s`} items={picked} onClear={() => setDecade(null)} /> : null}
        </View>

        {/* No "You vs the crowd" since 2026-11-05 (Nils, Miro board: "remove this entire section"). */}
        {data.sections.map((s) => (
          <FacetRatings
            key={s.kind} kind={s.kind as 'tag' | 'person' | 'company'} title={s.title} hint={s.hint}
            facets={data.facets} baseline={data.baseline} taxonomy={taxonomy} cols={width >= breakpoint.sm ? 2 : 1}
          />
        ))}
        {/* No "Most watched" since 2026-11-05 (Nils): a box's "Most picked" sort says the same. */}
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
  // SubBar's count-and-sort line, and kit's SortMenu trigger and menu rows.
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 30, marginTop: 8, marginBottom: 12 },
  metaRight: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  menuTrigger: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  menuItem: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 },
  weighing: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 24 },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8, paddingHorizontal: 4 },
  more: { alignSelf: 'flex-start', paddingTop: 6, paddingHorizontal: 4 },
  sheetHead: { flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingHorizontal: 18, paddingTop: 10 },
  sheetBody: { padding: 14 },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  // A wrapping grid with a 12 px gutter: each cell pads half of it.
  wrap: { flexDirection: 'row', flexWrap: 'wrap', margin: -6 },
  cell: { padding: 6 },
  overviewCell: { flex: 1, minWidth: 52, paddingHorizontal: 6, paddingVertical: 8, alignItems: 'center', justifyContent: 'center' },
  overviewValue: { fontFamily: font.sansBold, fontSize: 15, lineHeight: 19, color: color.textPrimary, fontVariant: ['tabular-nums'] },
  overviewIcon: { height: 14, marginTop: 2, justifyContent: 'center' },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  barCol: { flex: 1, minWidth: 0, height: '100%', alignItems: 'center', justifyContent: 'flex-end' },
  eraRail: { height: 160, minWidth: '100%' },
  eraCol: { width: 44, height: '100%', alignItems: 'center', justifyContent: 'flex-end' },
  barCount: { fontFamily: font.mono, fontSize: 10, lineHeight: 12, color: color.textSecondary, marginBottom: 2 },
  barLabel: { fontFamily: font.mono, fontSize: 10, lineHeight: 12, color: color.textSecondary, marginTop: 4 },
  typeHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  dot: { width: 8, height: 8, borderRadius: radius.full },
  column: { padding: 12, borderRadius: radius.xl },
  statBar: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 30, paddingHorizontal: 4 },
  track: { width: 56, height: 6, borderRadius: 3, backgroundColor: color.surfaceInset, overflow: 'hidden' },
  statBarValue: { width: 26, textAlign: 'right', fontFamily: font.sansBold, fontSize: 12, lineHeight: 15, fontVariant: ['tabular-nums'] },
  // Fixed widths from here right, or a "×120" pushes its row's bar left of a "×3".
  statBarCount: { width: 34, textAlign: 'right', fontFamily: font.mono, fontSize: 10, lineHeight: 12, color: color.textSecondary },
  impact: {
    width: 40, textAlign: 'center', fontFamily: font.sansBold, fontSize: 11, lineHeight: 16, fontVariant: ['tabular-nums'],
    borderRadius: radius.full, overflow: 'hidden',
  },
  impactHead: { width: 40, textAlign: 'center', fontFamily: font.mono, fontSize: 8, lineHeight: 10, letterSpacing: 0.48, textTransform: 'uppercase', color: color.textSecondary },
});
