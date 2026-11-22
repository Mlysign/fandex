// Where Steam sends the browser back to after a "Connect Steam" (lib/steam.ts).
// The address carries Steam's answer after the `?`. This screen takes it out of
// the address, checks the `state` this tab kept, hands the answer to the
// Worker, and goes back to the page the connect was started on.
//
// A browser only. On a phone the answer comes back to the app itself
// (fandex://auth/steam) and AuthProvider finishes it; opened there, this goes
// to You.

import { useRouter, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { Button } from '~/components/kit';
import { useAuth } from '~/lib/AuthProvider';
import { usePageTitle } from '~/lib/pageTitle';
import { signInLanding } from '~/lib/returnTo';
import { APP_RETURN, takeSteamReturn } from '~/lib/steam';
import { color, space, type } from '~/theme';

export default function SteamReturn() {
  usePageTitle('Connecting Steam');
  const auth = useAuth();
  const router = useRouter();
  const [failed, setFailed] = useState<{ message: string; returnTo: string } | null>(null);
  const taken = useRef(false);

  // Wait until the device knows who is signed in: Steam is added to that
  // account, and without one the Worker refuses.
  const ready = auth.status !== 'loading';
  const { finishSteamConnect } = auth;
  useEffect(() => {
    if (!ready || taken.current) return;
    taken.current = true;
    if (Platform.OS !== 'web') { router.replace('/profile'); return; }
    // A phone's connect, being handed on to the app (lib/steam.ts): not this tab's to finish.
    if (APP_RETURN) return;

    const back = takeSteamReturn();
    const returnTo = back.returnTo as Href;
    if (!back.ok) {
      // Saying no at Steam is a decision, not a failure: back to where they were.
      if (back.reason === 'declined') router.replace(returnTo);
      else setFailed({ message: 'This did not come from this window, or it was already used. Start it again from Settings.', returnTo: back.returnTo });
      return;
    }
    finishSteamConnect(back.params, back.secret).then(
      (outcome) => router.replace((signInLanding(outcome, back.returnTo) ?? returnTo) as Href),
      (e: unknown) => setFailed({ message: e instanceof Error ? e.message : 'Connecting Steam did not finish.', returnTo: back.returnTo }),
    );
  }, [ready, finishSteamConnect, router]);

  return (
    <View style={styles.screen}>
      {APP_RETURN ? (
        <View style={styles.box}>
          <Text style={type.serifMd}>Back to the Fandex app</Text>
          <Text style={type.bodySm}>Connecting Steam continues in the app. If it did not open, tap the button.</Text>
          <Button label="Open the app" variant="primary" size="md" pill onPress={() => { window.location.href = APP_RETURN as string; }} />
        </View>
      ) : failed ? (
        <View style={styles.box}>
          <Text style={type.serifMd}>Steam was not connected</Text>
          <Text style={type.bodySm}>{failed.message}</Text>
          <Button label="Back" variant="primary" size="md" pill onPress={() => router.replace(failed.returnTo as Href)} />
        </View>
      ) : (
        <View style={styles.waiting}>
          <ActivityIndicator size="small" color={color.accent} />
          <Text style={type.caption}>Connecting Steam…</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.lg, backgroundColor: color.surface },
  box: { maxWidth: 420, gap: space.md, alignItems: 'flex-start' },
  waiting: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
