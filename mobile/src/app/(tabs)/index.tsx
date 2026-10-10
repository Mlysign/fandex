// Home. The site's landing page (src/app/HomePageClient.tsx): the type filter,
// then rails. Signed in: Up next, Recommended for you, Popular right now,
// Upcoming. Signed out: a panel that says what signing in unlocks, and the two
// public rails.
//
// Where the rails come from is lib/homeFeed.ts. Not here yet: Popular people,
// which needs person pages to lead to.

import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { CardRail, Rail } from '~/components/cards';
import { Button, EmptyState, Eyebrow, Panel, Skeleton } from '~/components/kit';
import { SubBar } from '~/components/SubBar';
import { Screen } from '~/components/ui';
import { UpNextRail } from '~/components/UpNext';
import { useAuth } from '~/lib/AuthProvider';
import type { CardItem } from '~/lib/cards';
import { useHomeRails } from '~/lib/useHomeRails';
import { useTypeFilter } from '~/lib/typeFilter';
import { breakpoint, color, radius, type } from '~/theme';

/** A rail's worth of placeholders, the size of the cards that replace them. */
function RailSkeleton({ title }: { title: string }) {
  return (
    <Rail title={title}>
      {Array.from({ length: 6 }, (_, i) => (
        <View key={i} style={styles.skeletonCard}>
          <Skeleton style={{ width: '100%', aspectRatio: 2 / 3 }} />
          <View style={{ padding: 10, gap: 7, height: 98 }}>
            <Skeleton style={{ height: 12, width: '80%', borderRadius: radius.xs }} />
            <Skeleton style={{ height: 12, width: '40%', borderRadius: radius.xs }} />
            <Skeleton style={{ height: 28, marginTop: 'auto', borderRadius: radius.md }} />
          </View>
        </View>
      ))}
    </Rail>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const auth = useAuth();
  const types = useTypeFilter();
  const { width } = useWindowDimensions();
  const roomy = width >= breakpoint.md;
  const { feed, failed, load, recommendation, withoutHidden, signedIn, personalPending } = useHomeRails();

  const rail = (title: string, items: CardItem[] | null | undefined, seeAllHref: string, forYou = false) => {
    if (!items?.length) return null;
    const shown = withoutHidden(items).filter((i) => types.isVisible(i.type));
    if (shown.length) return <CardRail title={title} items={shown} seeAllHref={seeAllHref} forYou={forYou} />;
    // The rail has titles, and none of a type you are looking at. Say so; an absent rail reads as broken.
    return (
      <Rail title={title} forYou={forYou} seeAllHref={seeAllHref}>
        <Text style={[type.bodySm, { paddingVertical: 24 }]}>
          Nothing here matches the types you track.{' '}
          <Text accessibilityRole="link" onPress={() => router.push('/settings')} style={{ color: color.accent, textDecorationLine: 'underline' }}>
            Change that
          </Text>
          .
        </Text>
      </Rail>
    );
  };

  const hasRails = !!(feed?.trending.length || feed?.upcoming.length || recommendation?.length);

  return (
    <Screen wide>
      <SubBar />
      <ScrollView contentContainerStyle={[styles.main, roomy && { paddingVertical: 32, gap: 32 }]}>
        {auth.status === 'signedOut' ? (
          <Panel style={styles.guest}>
            <Eyebrow>Guest mode</Eyebrow>
            <Text style={[type.serifLg, { marginTop: 6, marginBottom: 12 }]}>Sign in to unlock your Fandex Score</Text>
            <View style={styles.guestActions}>
              <Button label="Create account" variant="primary" pill onPress={() => router.push('/profile')} />
              <Text accessibilityRole="link" onPress={() => router.push('/discover')} style={[type.label, { color: color.textSecondary }]}>
                Browse without an account →
              </Text>
            </View>
          </Panel>
        ) : null}

        {signedIn && types.isVisible('show') ? <UpNextRail /> : null}

        {failed && !feed ? (
          <EmptyState
            title="Couldn't load today's page"
            hint="The release feed did not answer. What is on this device still works."
            actions={<Button label="Try again" variant="secondary" size="md" onPress={load} />}
          />
        ) : !feed ? (
          <>
            {signedIn ? <RailSkeleton title="Recommended for you" /> : null}
            <RailSkeleton title="Popular right now" />
          </>
        ) : !hasRails && !personalPending ? (
          <EmptyState title="Nothing to show right now" hint="The providers didn't return any releases for today's page." />
        ) : (
          <>
            {personalPending ? <RailSkeleton title="Recommended for you" /> : rail('Recommended for you', recommendation, '/discover', true)}
            {rail('Popular right now', feed.trending, '/discover')}
            {rail('Upcoming', feed.upcoming, '/calendar')}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  main: { width: '100%', maxWidth: 1024, alignSelf: 'center', paddingHorizontal: 20, paddingVertical: 16, gap: 24 },
  guest: { paddingHorizontal: 16, paddingVertical: 16 },
  guestActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 },
  skeletonCard: {
    width: 150, overflow: 'hidden', borderRadius: radius.md, borderWidth: 1, borderColor: color.border, backgroundColor: color.surfaceElevated,
  },
});
