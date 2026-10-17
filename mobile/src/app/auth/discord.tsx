// Where Discord sends the browser back to after a sign-in (lib/discord.ts). The
// address carries Discord's access token after the `#`. This screen takes it out
// of the address, checks the `state` this tab kept, hands the token to the
// Worker, and goes back to the page the sign-in was started on.
//
// A browser only. On a phone the sign-in comes back to the app itself
// (fandex://auth/discord) and AuthProvider finishes it; opened there, this goes
// to You.

import { useRouter, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { Button } from '~/components/kit';
import { useAuth } from '~/lib/AuthProvider';
import { takeDiscordReturn } from '~/lib/discord';
import { usePageTitle } from '~/lib/pageTitle';
import { color, space, type } from '~/theme';

export default function DiscordReturn() {
  usePageTitle('Signing in');
  const auth = useAuth();
  const router = useRouter();
  const [failed, setFailed] = useState<{ message: string; returnTo: string } | null>(null);
  const taken = useRef(false);

  // Wait until the device knows whether it already has a session. With one, the
  // Worker adds Discord to that account; sent too early, it would start a new one.
  const ready = auth.status !== 'loading';
  const { finishDiscordSignIn } = auth;
  useEffect(() => {
    if (!ready || taken.current) return;
    taken.current = true;
    if (Platform.OS !== 'web') { router.replace('/profile'); return; }

    const back = takeDiscordReturn();
    const returnTo = back.returnTo as Href;
    if (!back.ok) {
      // Saying no at Discord is a decision, not a failure: back to where they were.
      if (back.reason === 'declined') router.replace(returnTo);
      else setFailed({ message: 'This sign-in did not come from this window, or it was already used. Start it again.', returnTo: back.returnTo });
      return;
    }
    finishDiscordSignIn(back.accessToken).then(
      () => router.replace(returnTo),
      (e: unknown) => setFailed({ message: e instanceof Error ? e.message : 'The sign-in did not finish.', returnTo: back.returnTo }),
    );
  }, [ready, finishDiscordSignIn, router]);

  return (
    <View style={styles.screen}>
      {failed ? (
        <View style={styles.box}>
          <Text style={type.serifMd}>Discord sign-in did not finish</Text>
          <Text style={type.bodySm}>{failed.message}</Text>
          <Button label="Back" variant="primary" size="md" pill onPress={() => router.replace(failed.returnTo as Href)} />
        </View>
      ) : (
        <View style={styles.waiting}>
          <ActivityIndicator size="small" color={color.accent} />
          <Text style={type.caption}>Signing you in…</Text>
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
