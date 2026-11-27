// Recommendations: what Fandex would pick for you, and why.
//
// The app's own page (Nils, 2026-11-26), where Home's "Recommended for you"
// leads with See all. Two kinds of rail:
//
//   Your best matches       Home's rail, twice as long: the titles your Fandex
//                           Score puts above your usual (lib/useHomeRails.ts).
//   Because you seek out X  one per thing you pick far more often than an
//                           ordinary library holds (lib/seekOut.ts): the titles
//                           carrying it that you have not been through.
//
// The second kind is where pull is shown since it left the score's side
// (docs/fandex-score.md §3.7): the facet picks, the score only gates, so no
// rail carries a title the score would paint orange.
//
// Every state says which it is. A page of rails that is empty reads as broken,
// and here "still working it out", "no comparison titles on this device yet"
// and "nothing stands out yet" are three different answers.

import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { CardRail } from '~/components/cards';
import { Button, EmptyState, Eyebrow } from '~/components/kit';
import { seekHref } from '~/components/SeekOut';
import { SignIn } from '~/components/SignIn';
import { SubBar } from '~/components/SubBar';
import { Screen } from '~/components/ui';
import { useAuth } from '~/lib/AuthProvider';
import { useCandidatePool } from '~/lib/CandidatePoolProvider';
import type { CardItem } from '~/lib/cards';
import { useCatalogSync } from '~/lib/CatalogSyncProvider';
import { useHiddenIds } from '~/lib/hidden';
import { usePageTitle } from '~/lib/pageTitle';
import { facetIndex, type FacetIndex } from '~/lib/related';
import { useScores } from '~/lib/ScoreProvider';
import { pullSentence } from '~/lib/scoreReasons';
import { seekRails, type SeekRail } from '~/lib/seekOut';
import { useSeekOut } from '~/lib/SeekOutProvider';
import { useTypeFilter } from '~/lib/typeFilter';
import { useHomeRails } from '~/lib/useHomeRails';
import { breakpoint, color, type } from '~/theme';

/** How many titles "Your best matches" holds here: twice Home's rail. */
const BEST_SIZE = 30;

const NO_IDS: ReadonlySet<string> = new Set();

/** The titles on your wishlist: a rail may carry a couple of them, never be made of them. */
function useWishlistedIds(): ReadonlySet<string> {
  const db = useSQLiteContext();
  const { rowsRevision, status } = useAuth();
  const [ids, setIds] = useState<ReadonlySet<string>>(NO_IDS);
  useEffect(() => {
    let live = true;
    if (status !== 'signedIn') { setIds(NO_IDS); return; }
    void db.getAllAsync<{ id: string }>("SELECT DISTINCT media_item_id AS id FROM item_state WHERE relation = 'wishlist'")
      .then((rows) => { if (live) setIds(rows.length ? new Set(rows.map((r) => r.id)) : NO_IDS); });
    return () => { live = false; };
  }, [db, rowsRevision, status]);
  return ids;
}

export default function RecommendationsScreen() {
  usePageTitle('Recommendations');
  const router = useRouter();
  const db = useSQLiteContext();
  const auth = useAuth();
  const catalog = useCatalogSync();
  const { taxonomy, center, ready } = useScores();
  const types = useTypeFilter();
  const hidden = useHiddenIds();
  const wishlisted = useWishlistedIds();
  const seek = useSeekOut();
  const pool = useCandidatePool();
  const { recommendation, personalPending, withoutHidden, failed, feed, load } = useHomeRails({ recommended: BEST_SIZE });
  const { width } = useWindowDimensions();
  const roomy = width >= breakpoint.md;
  const signedIn = auth.status === 'signedIn';

  // The screen stays mounted when you leave it. The facet index is a pass over
  // the whole catalog copy, so it is read only while this screen is in front.
  const [focused, setFocused] = useState(false);
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));

  // Which titles carry a facet: the index the title pages' rails already keep (lib/related.ts).
  const [index, setIndex] = useState<FacetIndex | null>(null);
  const wantsIndex = focused && signedIn && seek.facets.length > 0;
  useEffect(() => {
    let live = true;
    if (!wantsIndex || !taxonomy) return;
    facetIndex(db, catalog.revision, taxonomy)
      .then((built) => { if (live) setIndex(built); })
      .catch((e: unknown) => console.warn('fandex_recommendations_index_failed', e instanceof Error ? `${e.name}: ${e.message}` : String(e)));
    return () => { live = false; };
  }, [db, wantsIndex, taxonomy, catalog.revision]);

  const cardById = useMemo(() => new Map((pool?.cards ?? []).map((c) => [c.id as string, c])), [pool]);
  const typesKey = types.shown.join(',');
  const rails = useMemo<SeekRail<CardItem>[] | null>(() => {
    if (!index || !pool || !seek.facets.length) return null;
    return seekRails({
      facets: seek.facets,
      carriers: (facetId) => (index.byFacet.get(facetId) ?? []).map((at) => index.ids[at]),
      card: (id) => cardById.get(id),
      scoreOf: (id) => pool.scores.get(id),
      hidden, wishlisted,
      types: typesKey.split(',').filter(Boolean),
    });
  }, [index, pool, cardById, seek.facets, hidden, wishlisted, typesKey]);

  const best = useMemo(
    () => (recommendation ? withoutHidden(recommendation).filter((c) => types.isVisible(c.type)) : []),
    [recommendation, withoutHidden, types],
  );

  const head = (
    <View style={{ marginBottom: 4 }}>
      <Eyebrow>Picked for you</Eyebrow>
      <Text accessibilityRole="header" style={[type.serifXl, { marginTop: 4 }]}>Recommendations</Text>
    </View>
  );

  if (auth.status === 'signedOut') {
    return (
      <Screen wide>
        <View style={[styles.main, styles.page]}>
          {head}
          <SignIn title="Sign in to see your recommendations" hint="These are chosen from what you rate and what you pick. Sign in and they fill themselves in." />
        </View>
      </Screen>
    );
  }

  const busy = (text: string) => (
    <View style={styles.note}>
      <ActivityIndicator color={color.accent} />
      <Text style={[type.caption, { flexShrink: 1 }]}>{text}</Text>
    </View>
  );
  const say = (text: string) => <View style={styles.note}><Text style={[type.caption, { flexShrink: 1, textAlign: 'center' }]}>{text}</Text></View>;

  // Why there is no "Because you seek out" rail yet, or that there will be none: each its own sentence.
  const seekState = !ready || auth.rowsSyncing || seek.status === 'off' || seek.status === 'idle' || seek.status === 'working' ? busy('Working out what you seek out…')
    : seek.status === 'no-baseline' ? say('Fandex is still fetching the ordinary titles your picks are compared with. The "Because you seek out" rails fill in on their own.')
    : seek.status === 'no-picks' ? say('Add a few titles to your library or wishlist, and rails for what you seek out appear here.')
    : !seek.facets.length ? say('Nothing stands out in what you pick yet. It takes a few titles of one kind before Fandex calls it a habit.')
    : center == null ? say('Rate at least three titles: these rails leave out what your Fandex Score puts below your usual, and there is no score yet.')
    : !rails ? busy('Finding titles for what you seek out…')
    : !rails.length ? say('Everything Fandex holds for what you seek out is already in your library, or is not one of the types you are looking at.')
    : null;

  const feedFailed = failed && !feed;
  const bestRail = personalPending ? busy('Scoring the catalog for you…')
    : best.length ? <CardRail title="Your best matches" items={best} forYou recommended note="What your Fandex Score puts above your usual." />
    // The best matches wait for the release feed; the rails under them do not.
    : feedFailed ? (
      <View style={styles.note}>
        <Text style={[type.caption, { flexShrink: 1 }]}>The release feed did not answer, so your best matches are missing.</Text>
        <Button label="Try again" variant="secondary" size="sm" onPress={load} />
      </View>
    )
    : null;
  const nothingAtAll = !personalPending && !feedFailed && !best.length && seekState === null && !rails?.length;

  return (
    <Screen wide>
      <SubBar />
      {/* A list, so a rail far down the page mounts no posters until it is near (docs/app.md, "Memory is pictures"). */}
      <FlatList
        data={seekState === null ? rails ?? [] : []}
        keyExtractor={(rail) => rail.facet.id}
        contentContainerStyle={[styles.main, roomy && { paddingVertical: 32 }]}
        ItemSeparatorComponent={() => <View style={{ height: roomy ? 32 : 24 }} />}
        initialNumToRender={3} maxToRenderPerBatch={2} windowSize={5}
        ListHeaderComponent={(
          <View style={{ gap: roomy ? 32 : 24, marginBottom: roomy ? 32 : 24 }}>
            {head}
            {bestRail}
            {seekState}
            {nothingAtAll ? (
              <EmptyState
                title="Nothing to recommend right now"
                hint="Nothing Fandex holds scores above your usual for the types you are looking at."
                actions={<Button label="Browse instead" variant="secondary" size="md" onPress={() => router.push('/discover')} />}
              />
            ) : null}
          </View>
        )}
        renderItem={({ item }) => (
          <CardRail
            title={`Because you seek out ${item.facet.label}`}
            note={`${pullSentence(item.facet).replace(/^y/, 'Y')}.`}
            items={item.items}
            seeAllHref={seekHref(item.facet)}
          />
        )}
        ListFooterComponent={seekState === null && rails?.length ? (
          <Text style={[type.caption, styles.foot]}>
            A rail holds titles you have not watched, played or read that carry something you pick far more often than average, best match first.
            It leaves out what your Fandex Score puts below your usual.{' '}
            <Text accessibilityRole="link" onPress={() => router.push('/insights')} style={{ color: color.accent, textDecorationLine: 'underline' }}>
              Everything you seek out is on Insights
            </Text>
            .
          </Text>
        ) : null}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  // Home's column: max-w-5xl, px-5.
  main: { width: '100%', maxWidth: 1024, alignSelf: 'center', paddingHorizontal: 20, paddingVertical: 16 },
  page: { gap: 24 },
  note: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 24 },
  foot: { marginTop: 32, textAlign: 'center' },
});
