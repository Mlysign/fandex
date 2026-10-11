// The sign-in card. Two ways in: Trakt, which also brings a library along, and
// Google, which only proves who you are.
//
// Trakt: on a phone the button opens Trakt's own page and comes back signed in.
// In a browser Trakt gives a short code to confirm on its site; the code is
// filled in for you when you open Trakt from here, and a tap copies it.
//
// Google: in a browser the page goes to Google and comes back to
// /auth/google (lib/google.ts). Not on the phone yet (docs/app.md).

import * as Clipboard from 'expo-clipboard';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { BrandGlyph } from '~/components/BrandGlyph';
import { GoogleMark } from '~/components/GoogleMark';
import { Button, Panel } from '~/components/kit';
import { useAuth } from '~/lib/AuthProvider';
import { LOCAL_API } from '~/lib/config';
import { googleAvailable, startGoogleSignIn } from '~/lib/google';
import { activationUrl } from '~/lib/trakt';
import { color, font, radius, space, type } from '~/theme';

/** Leave for Google, coming back to the page this was pressed on. Only where `googleAvailable()`. */
export function useGoogleSignIn(): { start: () => void; leaving: boolean; error: string | null } {
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = () => {
    setLeaving(true);
    setError(null);
    const here = `${window.location.pathname}${window.location.search}`;
    startGoogleSignIn(here).catch((e: unknown) => {
      console.warn('google_sign_in_not_started', e instanceof Error ? `${e.name}: ${e.message}` : String(e));
      setLeaving(false);
      setError('Could not open Google from this window. A private window that blocks storage cannot sign in this way.');
    });
  };
  return { start, leaving, error };
}

/** The Trakt code, while the person confirms it at trakt.tv. Shown for `auth.trakt.phase === 'waiting'`. */
export function TraktCodeCard() {
  const auth = useAuth();
  const flow = auth.trakt;
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  if (flow.phase !== 'waiting') return null;

  const url = activationUrl(flow);
  const open = () => void (Platform.OS === 'web' ? Linking.openURL(url) : WebBrowser.openBrowserAsync(url));
  const copy = () => void Clipboard.setStringAsync(flow.userCode).then(() => setCopied(true));
  return (
    <Panel style={styles.card}>
      <Text style={type.serifMd}>Confirm this code on Trakt</Text>
      <Text style={type.bodySm}>
        Open Trakt and the code is already filled in. Confirm it there and this screen carries on by itself.
      </Text>
      <Pressable
        onPress={copy}
        accessibilityRole="button"
        accessibilityLabel={`Code ${flow.userCode.split('').join(' ')}. Tap to copy.`}
        style={({ pressed }) => [styles.codeBox, pressed && { opacity: 0.6 }]}>
        <Text style={styles.code}>{flow.userCode}</Text>
        <Text style={[type.meta, { color: copied ? color.accent : color.textMuted }]}>{copied ? 'Copied' : 'Tap to copy'}</Text>
      </Pressable>
      <View style={styles.actions}>
        <Button label="Open Trakt" variant="primary" size="md" pill onPress={open} />
        <Button label="Cancel" variant="outline" size="md" pill onPress={auth.cancelTraktSignIn} />
      </View>
      <View style={styles.waiting}>
        <ActivityIndicator size="small" color={color.accent} />
        <Text style={type.caption}>Waiting for Trakt…</Text>
      </View>
    </Panel>
  );
}

export function SignIn({ title = 'Sign in', hint }: { title?: string; hint?: string }) {
  const auth = useAuth();
  const flow = auth.trakt;
  const google = useGoogleSignIn();
  const withGoogle = googleAvailable();

  if (flow.phase === 'waiting') return <TraktCodeCard />;

  const busy = flow.phase === 'starting' || flow.phase === 'finishing' || google.leaving;
  return (
    <Panel style={styles.card}>
      <Text style={type.serifMd}>{title}</Text>
      <Text style={type.bodySm}>
        {hint ?? 'Your library, ratings and wishlist live in your Fandex account. Sign in with Trakt to bring them to this device.'}
      </Text>
      {flow.phase === 'error' ? <Text style={[type.caption, { color: color.danger }]}>{flow.message}</Text> : null}
      {google.error ? <Text style={[type.caption, { color: color.danger }]}>{google.error}</Text> : null}
      {busy ? (
        <View style={styles.waiting}>
          <ActivityIndicator size="small" color={color.accent} />
          <Text style={type.caption}>
            {google.leaving ? 'Opening Google…' : flow.phase === 'starting' ? 'Waiting for Trakt…' : 'Signing you in…'}
          </Text>
        </View>
      ) : (
        <View style={styles.actions}>
          <Button
            label="Continue with Trakt" variant="secondary" size="lg" onPress={auth.startTraktSignIn}
            icon={<BrandGlyph source="trakt" size={16} />}
          />
          {withGoogle ? (
            <Button label="Continue with Google" variant="secondary" size="lg" onPress={google.start} icon={<GoogleMark size={16} />} />
          ) : null}
          {Platform.OS !== 'web' ? <Button label="Use a code instead" variant="ghost" size="lg" onPress={auth.startTraktCodeSignIn} /> : null}
        </View>
      )}
      {withGoogle && !busy ? (
        <Text style={type.caption}>Trakt brings what you have watched and rated there. Google only signs you in, and you can add Trakt later in Settings.</Text>
      ) : null}
      {/* Only when the app talks to a Worker on this machine (lib/config.ts). The accounts are made for wrecking. */}
      {LOCAL_API && !busy ? (
        <View style={styles.actions}>
          <Button label="Test account" variant="outline" size="md" onPress={() => void auth.devSignIn('smoketest')} />
          <Button label="Second test account" variant="ghost" size="md" onPress={() => void auth.devSignIn('plain')} />
        </View>
      ) : null}
    </Panel>
  );
}

const styles = StyleSheet.create({
  card: { padding: space.lg, gap: space.md },
  codeBox: {
    alignItems: 'center', gap: space.xs, paddingVertical: space.lg, borderRadius: radius.md,
    backgroundColor: color.surfaceInset, borderWidth: 1, borderColor: color.borderStrong,
  },
  code: { fontFamily: font.mono, fontSize: 26, lineHeight: 30, letterSpacing: 6, color: color.accent },
  waiting: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
