// How the Fandex Score works, for anybody. The Why sheet used to open with a
// paragraph on it and close with two more; Nils (Miro board, 2026-11-05): "too
// much", put it on a page of its own and link it from the sheet. The sheet now
// ends with that link.
//
// The device's own measurement ("within one point X% of the time") lives here
// too, so the number stays honest about how right it is (docs/decisions.md).
// The picture of the whole spec is public/score-how-it-works.svg, on /dev/score.

import { useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Eyebrow } from '~/components/kit';
import { LegalLinks } from '~/components/LegalLinks';
import { Screen } from '~/components/ui';
import { useAuth } from '~/lib/AuthProvider';
import { usePageTitle } from '~/lib/pageTitle';
import { useScores } from '~/lib/ScoreProvider';
import { calibrationLine } from '~/lib/scoreReasons';
import { color, radius, type } from '~/theme';

const SECTIONS: { title: string; text: string }[] = [
  {
    title: 'One number',
    text: 'Your Fandex Score is what you would probably rate a title, times ten. A 72 means you would probably give it about a 7. It is right to about a point, not to a tenth.',
  },
  {
    title: 'It starts at your average',
    text: 'Every title starts from your own average for its medium. If you give films 6.4 on average, a film starts at 64. A title nothing else can be said about stays there.',
  },
  {
    title: 'What moves it',
    text: 'A title is made of genres, tags, people, a studio and a franchise. Each one moves the number by how you rated the other titles that have it. Something you have met once barely moves it. Something you have met forty times moves it fully.',
  },
  {
    title: 'Only your ratings',
    text: 'Only ratings you gave count. The crowd\'s ratings and what is popular never do.',
  },
  {
    title: 'It never quotes you',
    text: 'A title you rated is scored as if you had not rated it, so the number never just repeats your own rating back to you.',
  },
];

const MEDIA = ['movie', 'show', 'game', 'book'] as const;

export default function ScoreScreen() {
  usePageTitle('How the score works');
  const router = useRouter();
  const auth = useAuth();
  const { calibrationFor } = useScores();

  // Each medium's own measurement where the device has one; every medium together otherwise.
  const own = MEDIA.map((m) => calibrationFor(m)).filter((c) => c && c.medium !== 'all');
  const lines = (own.length ? own : [calibrationFor()]).map((c) => calibrationLine(c ?? null)).filter((l): l is string => !!l);

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.main}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/' as never))} accessibilityRole="button" accessibilityLabel="Back" hitSlop={8} style={styles.back}>
          <ArrowLeft size={16} color={color.textSecondary} />
        </Pressable>
        <View>
          <Eyebrow>Your Fandex Score</Eyebrow>
          <Text accessibilityRole="header" style={[type.serifXl, { marginTop: 4 }]}>How the score works</Text>
        </View>

        {SECTIONS.map((s) => (
          <View key={s.title} style={styles.section}>
            <Text style={type.label}>{s.title}</Text>
            <Text style={[type.bodySm, styles.text]}>{s.text}</Text>
          </View>
        ))}

        {auth.status === 'signedIn' && lines.length ? (
          <View style={styles.section}>
            <Text style={type.label}>How right it has been for you</Text>
            {lines.map((l) => <Text key={l} style={[type.bodySm, styles.text]}>{l}</Text>)}
            <Text style={[type.caption, styles.text]}>Measured on this device, on titles you rated, each scored as if you had not.</Text>
          </View>
        ) : null}

        <Text style={[type.caption, styles.text]}>Tap &quot;Why?&quot; under a title&apos;s score to see what moved its number.</Text>
        <LegalLinks />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  main: { width: '100%', maxWidth: 672, alignSelf: 'center', paddingHorizontal: 24, paddingVertical: 24, gap: 24 },
  back: {
    width: 40, height: 40, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: color.border,
  },
  section: { gap: 6 },
  text: { color: color.textSecondary },
});
