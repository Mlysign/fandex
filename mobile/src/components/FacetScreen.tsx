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
import { creditLine } from '~/lib/creditLine';
import { spokenKey, type PageImpact } from '~/lib/facetImpact';
import { useCatalogSync } from '~/lib/CatalogSyncProvider';
import type { CatalogRow } from '~/lib/db';
import { usePageTitle } from '~/lib/pageTitle';
import { dropFacetPrerender } from '~/lib/prerender';
import { byPopularity, byRating } from '~/lib/sortCards';
import { longDate } from '~/lib/dates';
import { providerFacet, type FacetPerson } from '~/lib/facetProviders';
import { PhotoGallery } from '~/components/PhotoGallery';
import { count } from '~/lib/plural';
import { useRowScores, useScores } from '~/lib/ScoreProvider';
import { signed } from '~/lib/scoreReasons';
import { color, font, radius, type } from '~/theme';

export type { FacetKind } from '~/components/FacetHeader';

type Sort = 'popularity' | 'releaseDate' | 'rating' | 'fandexScore';
const SORTS: [Sort, string][] = [['popularity', 'Popularity'], ['releaseDate', 'Release date'], ['rating', 'Rating'], ['fandexScore', 'Fandex Score']];

interface StoredFacet { kind: string; key: string; label: string; role?: string; category?: string }

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
  const { center, impactsFor, taxonomy } = useScores();
  const impacts = useMemo(() => impactsFor(kind === 'studio' ? 'company' : kind, key), [impactsFor, kind, key]);
  const [sort, setSort] = useState<Sort>('popularity');
  const [bioOpen, setBioOpen] = useState(false);
  /** The photo the gallery is open on, or null while it is shut. */
  const [photoAt, setPhotoAt] = useState<number | null>(null);
  const [found, setFound] = useState<{ label: string; category: string | null; roles: string[]; cards: CardItem[] } | null>(null);

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
      let category: string | null = null;
      const roles = new Map<string, number>();
      const cards: CardItem[] = [];
      for (const r of rows) {
        let hit: StoredFacet[] = [];
        try { hit = (JSON.parse(r.facets) as StoredFacet[]).filter((f) => matches(f, kind, key)); } catch { /* an unreadable row is not a match */ }
        if (!hit.length) continue;
        label ||= hit[0].label;
        category ??= hit.find((f) => f.category)?.category ?? null;
        for (const f of hit) if (f.role) roles.set(f.role, (roles.get(f.role) ?? 0) + 1);
        // What they did on this one, under its name: "Director · Writer", "Author". A tag has no role.
        cards.push({ ...cardFromCatalog(r), role: creditLine(r.type, hit.map((f) => f.role)) });
      }
      if (live) setFound({ label, category, roles: [...roles.entries()].sort((a, b) => b[1] - a[1]).map(([r]) => r), cards });
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
    // The provider's copy of a title the device holds is dropped, but its credit
    // is kept: the device knows "Cast", TMDB knows "as Tony Stark".
    const twinRole = new Map<string, string>();
    for (const c of more.cards) {
      if (!c.role) continue;
      if (c.id) twinRole.set(`id:${c.id}`, c.role);
      twinRole.set(ident(c), c.role);
    }
    const credited = own.map((c) => {
      const r = (c.id && twinRole.get(`id:${c.id}`)) || twinRole.get(ident(c));
      return r && r !== c.role ? { ...c, role: r } : c;
    });
    return [...credited, ...more.cards.filter((c) => !(c.id && ids.has(c.id)) && !names.has(ident(c)))];
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

  // The site's like-for-like line (PublicFacetView, SM22): over the titles you
  // rated, your average against the crowd's average for those same titles.
  const delta = useMemo(() => {
    const pairs = (cards ?? [])
      .map((c) => ({ mine: stateOf(c.id).rating, crowd: c.communityScore }))
      .filter((p): p is { mine: number; crowd: number } => p.mine != null && p.mine > 0 && p.crowd != null);
    if (!pairs.length) return null;
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    return { n: pairs.length, d: avg(pairs.map((p) => p.mine)) - avg(pairs.map((p) => p.crowd / 10)) };
  }, [cards, stateOf]);

  // A tag's place in the taxonomy (the site's Q18): its category, and the
  // spellings bundled into it ("Also known as").
  const tagCategory = kind === 'tag' && taxonomy
    ? taxonomy.categories.get(taxonomy.tagCategoryOverrides.get(key) ?? found?.category ?? 'other')?.label ?? null
    : null;
  const akas = kind === 'tag' && taxonomy
    ? [...taxonomy.tagAliases.entries()].filter(([alias, canon]) => spokenKey(canon) === key && spokenKey(alias) !== key).map(([alias]) => alias)
    : [];

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
      avatar={person?.profileUrl ? (
        // The portrait opens every photo TMDB holds of them (Nils, 2026-10-17).
        person.photos.length ? (
          <Pressable onPress={() => setPhotoAt(0)} accessibilityRole="button" accessibilityLabel={`${count(person.photos.length, 'photo')} of ${name}`}
            style={(s) => [{ borderRadius: 999 }, (s as { hovered?: boolean }).hovered && { opacity: 0.85 }]}>
            <Avatar src={person.profileUrl} name={name} size={84} />
            {person.photos.length > 1 ? <View style={styles.photoCount}><Text style={styles.photoCountText}>{person.photos.length}</Text></View> : null}
          </Pressable>
        ) : <Avatar src={person.profileUrl} name={name} size={84} />
      ) : null}
      life={life}
      bio={person?.biography ? (
        <Pressable onPress={() => setBioOpen((v) => !v)} accessibilityRole="button" accessibilityLabel={bioOpen ? 'Show less of the biography' : 'Show the whole biography'}>
          <Text numberOfLines={bioOpen ? undefined : 4} style={[type.bodySm, styles.bio]}>{person.biography}</Text>
        </Pressable>
      ) : null}
      tiles={tiles}
      extra={(
        <>
          {tagCategory || akas.length ? (
            <View style={styles.tagMeta}>
              {tagCategory ? <Text style={[type.caption, styles.categoryChip]}>{tagCategory}</Text> : null}
              {akas.length ? <Text style={[type.caption, { flexShrink: 1 }]}>Also known as: {akas.join(', ')}</Text> : null}
            </View>
          ) : null}
          {delta ? (
            <Text style={[type.bodySm, { marginTop: 12 }]}>
              Across the {delta.n} you&apos;ve rated, you score {name}{' '}
              {Math.abs(delta.d) < 0.05 ? 'the same as the crowd' : `${Math.abs(delta.d).toFixed(1)} ${delta.d > 0 ? 'higher' : 'lower'} than the crowd`}
            </Text>
          ) : null}
          {impacts.map((im) => (
            <View key={im.role ?? 'tag'} style={styles.impact}>
              <Text style={[styles.impactPill, IMPACT_TONE[im.direction]]}>Fandex impact {signed(im.points)}</Text>
              <Text style={[type.bodySm, { flex: 1, minWidth: 0 }]}>{impactLine(kind, im)}</Text>
            </View>
          ))}
        </>
      )}
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
      {photoAt != null && person?.photos.length ? <PhotoGallery photos={person.photos} name={name} start={photoAt} onClose={() => setPhotoAt(null)} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  bio: { marginTop: 12, maxWidth: 720 },
  photoCount: {
    position: 'absolute', right: -2, bottom: -2, minWidth: 22, height: 22, paddingHorizontal: 5, borderRadius: radius.full,
    alignItems: 'center', justifyContent: 'center', backgroundColor: color.surfaceOverlay, borderWidth: 1, borderColor: color.borderStrong,
  },
  photoCountText: { fontFamily: font.mono, fontSize: 10, color: color.textPrimary },
  impact: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  tagMeta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 12 },
  categoryChip: {
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.full, overflow: 'hidden',
    backgroundColor: `${color.facet.tag}21`, color: color.textPrimary,
  },
  impactPill: {
    fontFamily: font.sansBold, fontSize: 14, lineHeight: 20, fontVariant: ['tabular-nums'],
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.full, overflow: 'hidden',
  },
});
