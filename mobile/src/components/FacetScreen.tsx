// A tag, a person or a studio: what it is, how the crowd and you rate it, and
// every title in the catalog that carries it. The site's facet page
// (src/components/facet/PublicFacetView.tsx), from the catalog on the device.
//
// One page per person, tag or studio, as on the site: a person's page shows
// everything they worked on, whatever the role, and `/studio` folds developer,
// publisher, studio and network together.
//
// Not carried over: a person's photo and biography, "also known as", and the
// titles the catalog does not hold (the site fetched those from the providers).

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { ArrowLeft } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { slugToKey } from '@/lib/facetUrl';
import { PosterGrid } from '~/components/cards';
import { Avatar, EmptyState, SortMenu } from '~/components/kit';
import { backButtonStyle, FacetHeader, facetEyebrow, KIND_LABEL, ROLE_LABEL, type FacetKind } from '~/components/FacetHeader';
import { Screen, StateBlock } from '~/components/ui';
import { useAuth } from '~/lib/AuthProvider';
import { cardFromCatalog, useCardStates, type CardItem } from '~/lib/cards';
import { spokenKey, type PageImpact } from '~/lib/facetImpact';
import { useCatalogSync } from '~/lib/CatalogSyncProvider';
import type { CatalogRow } from '~/lib/db';
import { usePageTitle } from '~/lib/pageTitle';
import { dropFacetPrerender } from '~/lib/prerender';
import { byPopularity, byRating } from '~/lib/sortCards';
import { longDate } from '~/lib/dates';
import { providerFacet, type FacetPerson } from '~/lib/facetProviders';
import { useRowScores, useScores } from '~/lib/ScoreProvider';
import { signed } from '~/lib/scoreReasons';
import { color, font, radius, type } from '~/theme';

export type { FacetKind } from '~/components/FacetHeader';

type Sort = 'popularity' | 'releaseDate' | 'rating' | 'fandexScore';
const SORTS: [Sort, string][] = [['popularity', 'Popularity'], ['releaseDate', 'Release date'], ['rating', 'Rating'], ['fandexScore', 'Fandex Score']];

interface StoredFacet { kind: string; key: string; label: string; role?: string }

/** Does a stored facet belong on this page? */
const matches = (f: StoredFacet, kind: FacetKind, key: string) =>
  spokenKey(f.key) === key && (kind === 'studio' ? f.kind === 'company' : f.kind === kind);

const IMPACT_TONE = {
  up: { backgroundColor: color.successSubtle, color: color.success },
  down: { backgroundColor: color.dangerSubtle, color: color.danger },
  neutral: { backgroundColor: color.surfaceElevated, color: color.textSecondary },
} as const;

/** The site's sentence for a tag. A person or a studio is scored per role, so theirs names the role. */
function impactLine(kind: FacetKind, im: PageImpact): string {
  const who = kind === 'tag' ? 'titles with this tag'
    : im.role === 'cast' ? 'titles with them in the cast'
    : `titles with them as ${(ROLE_LABEL[im.role ?? ''] ?? KIND_LABEL[kind]).toLowerCase()}`;
  const how = im.direction === 'up' ? 'typically score above your average'
    : im.direction === 'down' ? 'typically score below your average'
    : 'score about the same as your average';
  return `${who} ${how} · ${im.ratedCount} rated`;
}

export function FacetScreen({ kind }: { kind: FacetKind }) {
  const params = useLocalSearchParams<{ key: string }>();
  // The address says "christopher-nolan"; the catalog's key is "christopher nolan".
  const key = slugToKey(params.key ?? '');
  const router = useRouter();
  const db = useSQLiteContext();
  const auth = useAuth();
  const sync = useCatalogSync();
  const { center, impactsFor } = useScores();
  const impacts = useMemo(() => impactsFor(kind === 'studio' ? 'company' : kind, key), [impactsFor, kind, key]);
  const [sort, setSort] = useState<Sort>('popularity');
  const [bioOpen, setBioOpen] = useState(false);
  const [found, setFound] = useState<{ label: string; roles: string[]; cards: CardItem[] } | null>(null);

  useEffect(() => {
    let live = true;
    setFound(null);
    (async () => {
      // The key is inside a JSON column. LIKE narrows four thousand rows to a
      // handful; the parse below is what decides.
      // On the key's first word only: the rest may be stored with hyphens where the address has spaces.
      const escaped = (key.split(' ')[0] ?? '').replace(/[\\%_]/g, (c) => `\\${c}`);
      const rows = await db.getAllAsync<CatalogRow & { facets: string }>(
        `SELECT id, type, title, slug, poster_url, release_date, year, community_score, community_votes, facets
           FROM catalog WHERE facets LIKE ? ESCAPE '\\'`,
        [`%"key":"${escaped}%`],
      );
      let label = '';
      const roles = new Map<string, number>();
      const cards: CardItem[] = [];
      for (const r of rows) {
        let hit: StoredFacet[] = [];
        try { hit = (JSON.parse(r.facets) as StoredFacet[]).filter((f) => matches(f, kind, key)); } catch { /* an unreadable row is not a match */ }
        if (!hit.length) continue;
        label ||= hit[0].label;
        for (const f of hit) if (f.role) roles.set(f.role, (roles.get(f.role) ?? 0) + 1);
        cards.push(cardFromCatalog(r));
      }
      if (live) setFound({ label, roles: [...roles.entries()].sort((a, b) => b[1] - a[1]).map(([r]) => r), cards });
    })();
    return () => { live = false; };
  }, [db, kind, key, sync.revision]);

  // What TMDB has beyond the catalog copy. The device's rows show at once; these join them.
  const [more, setMore] = useState<{ cards: CardItem[]; person: FacetPerson | null } | null>(null);
  const [asking, setAsking] = useState(false);
  const label = found?.label ?? '';
  // The website's static copy of this page lies over the app until the app has the titles.
  useEffect(() => { if (found) dropFacetPrerender(); }, [found]);
  usePageTitle(label || null);
  const ready = found != null;
  useEffect(() => {
    setMore(null);
    if (!ready) return;
    const abort = new AbortController();
    setAsking(true);
    providerFacet(kind, key, label || key, abort.signal)
      .then((p) => { if (!abort.signal.aborted) setMore(p); })
      .catch(() => { /* offline or TMDB down: the page is what the device holds */ })
      .finally(() => { if (!abort.signal.aborted) setAsking(false); });
    return () => abort.abort();
  }, [kind, key, label, ready]);

  const cards = useMemo(() => {
    const own = found?.cards;
    if (!own || !more) return own;
    // The same title is one card: by Fandex id where the Worker knows it, else by type, name and year.
    const ident = (c: CardItem) => `${c.type}|${c.title.toLowerCase().replace(/[^a-z0-9]+/g, '')}|${c.releaseDate?.slice(0, 4) ?? ''}`;
    const ids = new Set(own.map((c) => c.id));
    const names = new Set(own.map(ident));
    return [...own, ...more.cards.filter((c) => !(c.id && ids.has(c.id)) && !names.has(ident(c)))];
  }, [found, more]);
  const ids = useMemo(() => (cards ?? []).map((c) => c.id), [cards]);
  const stateOf = useCardStates(ids);
  const scores = useRowScores(useMemo(() => (sort === 'fandexScore' ? ids.filter((i): i is string => !!i) : []), [sort, ids]));

  const sorted = useMemo(() => {
    const list = [...(cards ?? [])];
    const crowdOf = (c: CardItem) => ({ type: c.type, score: c.communityScore, votes: c.communityVotes ?? 0 });
    switch (sort) {
      case 'popularity': return byPopularity(list, crowdOf, true);
      case 'rating': return byRating(list, crowdOf);
      case 'fandexScore': return list.sort((a, b) => ((b.id ? scores.get(b.id) : null) ?? -1) - ((a.id ? scores.get(a.id) : null) ?? -1));
      case 'releaseDate': return list.sort((a, b) => ((b.releaseDate ?? '') < (a.releaseDate ?? '') ? -1 : 1));
    }
  }, [cards, sort, scores]);

  const tiles = useMemo(() => {
    const all = cards ?? [];
    const crowd = all.filter((c) => c.communityScore != null);
    const mine = all.map((c) => stateOf(c.id).rating).filter((r): r is number => r != null && r > 0);
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    return [
      { label: 'titles', value: String(all.length) },
      { label: 'crowd average', value: crowd.length ? (avg(crowd.map((c) => c.communityScore as number)) / 10).toFixed(1) : '-' },
      ...(auth.status === 'signedIn' ? [{ label: mine.length ? `your average · ${mine.length} rated` : 'your average', value: mine.length ? avg(mine).toFixed(1) : '-' }] : []),
    ];
  }, [cards, stateOf, auth.status]);

  if (!found) return <Screen wide><StateBlock loading /></Screen>;

  const person = more?.person ?? null;
  const name = found.label || person?.name || key.replace(/-/g, ' ');
  const life = person ? [person.birthday ? `Born ${longDate(person.birthday) ?? person.birthday}` : null, person.deathday ? `died ${longDate(person.deathday) ?? person.deathday}` : null, person.placeOfBirth].filter(Boolean).join(' · ') : '';
  const header = (
    <FacetHeader
      back={(
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/discover' as never))} accessibilityRole="button" accessibilityLabel="Back" hitSlop={8} style={backButtonStyle}>
          <ArrowLeft size={16} color={color.textSecondary} />
        </Pressable>
      )}
      eyebrow={facetEyebrow(kind, found.roles)}
      name={name}
      avatar={person?.profileUrl ? <Avatar src={person.profileUrl} name={name} size={84} /> : null}
      life={life}
      bio={person?.biography ? (
        <Pressable onPress={() => setBioOpen((v) => !v)} accessibilityRole="button" accessibilityLabel={bioOpen ? 'Show less of the biography' : 'Show the whole biography'}>
          <Text numberOfLines={bioOpen ? undefined : 4} style={[type.bodySm, styles.bio]}>{person.biography}</Text>
        </Pressable>
      ) : null}
      tiles={tiles}
      extra={impacts.map((im) => (
        <View key={im.role ?? 'tag'} style={styles.impact}>
          <Text style={[styles.impactPill, IMPACT_TONE[im.direction]]}>Fandex impact {signed(im.points)}</Text>
          <Text style={[type.bodySm, { flex: 1, minWidth: 0 }]}>{impactLine(kind, im)}</Text>
        </View>
      ))}
      count={`titles · ${(cards ?? []).length}${asking ? ' · asking TMDB for more…' : ''}`}
      sort={<SortMenu value={sort} options={center == null ? SORTS.filter(([k]) => k !== 'fandexScore') : SORTS} onChange={setSort} />}
    />
  );

  return (
    <Screen wide>
      <PosterGrid
        items={sorted}
        header={header}
        empty={asking ? <StateBlock loading /> : <EmptyState title="Nothing here yet" hint={sync.state === 'syncing' ? 'The catalog is still downloading.' : 'No title in the catalog or on TMDB carries this.'} />}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  bio: { marginTop: 12, maxWidth: 720 },
  impact: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  impactPill: {
    fontFamily: font.sansBold, fontSize: 14, lineHeight: 20, fontVariant: ['tabular-nums'],
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.full, overflow: 'hidden',
  },
});
