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
import { EmptyState, SortMenu, StatStrip } from '~/components/kit';
import { Screen, StateBlock } from '~/components/ui';
import { useAuth } from '~/lib/AuthProvider';
import { cardFromCatalog, useCardStates, type CardItem } from '~/lib/cards';
import { useCatalogSync } from '~/lib/CatalogSyncProvider';
import type { CatalogRow } from '~/lib/db';
import { useRowScores, useScores } from '~/lib/ScoreProvider';
import { color, radius, type } from '~/theme';

export type FacetKind = 'tag' | 'person' | 'studio';

const KIND_LABEL: Record<FacetKind, string> = { tag: 'Tag', person: 'Person', studio: 'Studio' };
const ROLE_LABEL: Record<string, string> = {
  director: 'Director', creator: 'Creator', writer: 'Writer', cast: 'Cast',
  developer: 'Developer', publisher: 'Publisher', studio: 'Studio', network: 'Network',
};

type Sort = 'popularity' | 'releaseDate' | 'rating' | 'fandexScore';
const SORTS: [Sort, string][] = [['popularity', 'Popularity'], ['releaseDate', 'Release date'], ['rating', 'Rating'], ['fandexScore', 'Fandex Score']];

interface StoredFacet { kind: string; key: string; label: string; role?: string }

/** A stored key as an address spells it: hyphens and runs of spaces are one space (src/lib/facetUrl.ts, slugToKey). */
const spoken = (key: string) => key.toLowerCase().replace(/-+/g, ' ').replace(/\s+/g, ' ').trim();

/** Does a stored facet belong on this page? */
const matches = (f: StoredFacet, kind: FacetKind, key: string) =>
  spoken(f.key) === key && (kind === 'studio' ? f.kind === 'company' : f.kind === kind);

export function FacetScreen({ kind }: { kind: FacetKind }) {
  const params = useLocalSearchParams<{ key: string }>();
  // The address says "christopher-nolan"; the catalog's key is "christopher nolan".
  const key = slugToKey(params.key ?? '');
  const router = useRouter();
  const db = useSQLiteContext();
  const auth = useAuth();
  const sync = useCatalogSync();
  const { center } = useScores();
  const [sort, setSort] = useState<Sort>('popularity');
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

  const cards = found?.cards;
  const ids = useMemo(() => (cards ?? []).map((c) => c.id), [cards]);
  const stateOf = useCardStates(ids);
  const scores = useRowScores(useMemo(() => (sort === 'fandexScore' ? ids.filter((i): i is string => !!i) : []), [sort, ids]));

  const sorted = useMemo(() => {
    const list = [...(cards ?? [])];
    const votes = (c: CardItem) => c.communityVotes ?? 0;
    switch (sort) {
      case 'popularity': return list.sort((a, b) => votes(b) - votes(a));
      case 'rating': return list.sort((a, b) => (b.communityScore ?? -1) - (a.communityScore ?? -1) || votes(b) - votes(a));
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
      { label: 'crowd average', value: crowd.length ? (avg(crowd.map((c) => c.communityScore as number)) / 10).toFixed(1) : '–' },
      ...(auth.status === 'signedIn' ? [{ label: mine.length ? `your average · ${mine.length} rated` : 'your average', value: mine.length ? avg(mine).toFixed(1) : '–' }] : []),
    ];
  }, [cards, stateOf, auth.status]);

  if (!found) return <Screen wide><StateBlock loading /></Screen>;

  const name = found.label || key.replace(/-/g, ' ');
  const header = (
    <View style={styles.header}>
      <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/discover' as never))} accessibilityRole="button" accessibilityLabel="Back" hitSlop={8} style={styles.back}>
        <ArrowLeft size={16} color={color.textSecondary} />
      </Pressable>
      <Text style={[type.eyebrow, { color: color.accent }]}>
        {kind === 'tag' ? KIND_LABEL.tag : found.roles.length ? found.roles.map((r) => ROLE_LABEL[r] ?? r).join(' · ') : KIND_LABEL[kind]}
      </Text>
      <Text accessibilityRole="header" style={[type.serifXl, { marginTop: 6 }]}>{name}</Text>
      <View style={{ marginTop: 16 }}><StatStrip cells={tiles} /></View>
      <View style={styles.sortRow}>
        <Text style={[type.micro, { color: color.accent, letterSpacing: 0.8 }]}>titles · {found.cards.length}</Text>
        <SortMenu value={sort} options={center == null ? SORTS.filter(([k]) => k !== 'fandexScore') : SORTS} onChange={setSort} />
      </View>
    </View>
  );

  return (
    <Screen wide>
      <PosterGrid
        items={sorted}
        header={header}
        empty={<EmptyState title="Nothing here yet" hint={sync.state === 'syncing' ? 'The catalog is still downloading.' : 'No title in the catalog carries this.'} />}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingBottom: 16 },
  back: {
    width: 36, height: 36, marginBottom: 16, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center',
    backgroundColor: color.surfaceElevated, borderWidth: 1, borderColor: color.border,
  },
  sortRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 20, minHeight: 30 },
});
