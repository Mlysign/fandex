// The sign-in card. Two ways in: Trakt, which also brings a library along, and
// Google, which only proves who you are.
//
// Trakt: on a phone the button opens Trakt's own page and comes back signed in.
// In a browser Trakt gives a short code to confirm on its site; the code is
// filled in for you when you open Trakt from here, and a tap copies it.
//
// Google: in a browser the page goes to Google and comes back to
// /auth/google; a phone opens a browser sheet that comes back through the site
// (lib/google.ts). Only in a build given the client id.
//
// Discord: a browser goes to Discord and back to /auth/discord, a phone opens a
// browser sheet (lib/discord.ts). Only in a build given the application id.

import * as Clipboard from 'expo-clipboard';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { BrandGlyph } from '~/components/BrandGlyph';
import { GoogleMark } from '~/components/GoogleMark';
import { Button, Panel } from '~/components/kit';
import { useAuth } from '~/lib/AuthProvider';
import { LOCAL_API } from '~/lib/config';
import { discordAvailable } from '~/lib/discord';
import { googleAvailable } from '~/lib/google';
import { activationUrl } from '~/lib/trakt';
import { color, font, radius, space, type } from '~/theme';

/**
 * Sign in with Google, coming back to the page this was pressed on. In a
 * browser the page leaves for Google; on a phone a browser sheet opens and
 * closes again. Only where `googleAvailable()`.
 */
export function useGoogleSignIn(): { start: () => void; leaving: boolean; error: string | null } {
  const auth = useAuth();
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = () => {
    setLeaving(true);
    setError(null);
    const web = Platform.OS === 'web';
    const here = web ? `${window.location.pathname}${window.location.search}` : '/profile';
    auth.startGoogleSignIn(here).then(
      // In a browser the page has left; on a phone the sheet has closed.
      () => { if (!web) setLeaving(false); },
      (e: unknown) => {
        console.warn('google_sign_in_not_started', e instanceof Error ? `${e.name}: ${e.message}` : String(e));
        setLeaving(false);
        setError(web
          ? 'Could not open Google from this window. A private window that blocks storage cannot sign in this way.'
          : e instanceof Error ? e.message : 'Could not open Google.');
      },
    );
  };
  return { start, leaving, error };
}

/** Sign in with Discord, coming back to the page this was pressed on. Only where `discordAvailable()`. */
export function useDiscordSignIn(): { start: () => void; leaving: boolean; error: string | null } {
  const auth = useAuth();
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = () => {
    setLeaving(true);
    setError(null);
    const here = Platform.OS === 'web' ? `${window.location.pathname}${window.location.search}` : '/profile';
    auth.startDiscordSignIn(here).then(
      // In a browser the page has left; on a phone the sheet has closed.
      () => { if (Platform.OS !== 'web') setLeaving(false); },
      (e: unknown) => {
        setLeaving(false);
        setError(e instanceof Error ? e.message : 'Could not open Discord.');
      },
    );
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
  const discord = useDiscordSignIn();
  const withDiscord = discordAvailable();

  if (flow.phase === 'waiting') return <TraktCodeCard />;

  const busy = flow.phase === 'starting' || flow.phase === 'finishing' || google.leaving || discord.leaving;
  return (
    <Panel style={styles.card}>
      <Text style={type.serifMd}>{title}</Text>
      <Text style={type.bodySm}>
        {hint ?? 'Your library, ratings and wishlist live in your Fandex account. Sign in with Trakt to bring them to this device.'}
      </Text>
      {flow.phase === 'error' ? <Text style={[type.caption, { color: color.danger }]}>{flow.message}</Text> : null}
      {google.error ? <Text style={[type.caption, { color: color.danger }]}>{google.error}</Text> : null}
      {discord.error ? <Text style={[type.caption, { color: color.danger }]}>{discord.error}</Text> : null}
      {busy ? (
        <View style={styles.waiting}>
          <ActivityIndicator size="small" color={color.accent} />
          <Text style={type.caption}>
            {google.leaving ? 'Opening Google…' : discord.leaving ? 'Waiting for Discord…' : flow.phase === 'starting' ? 'Waiting for Trakt…' : 'Signing you in…'}
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
          {withDiscord ? (
            <Button label="Continue with Discord" variant="secondary" size="lg" onPress={discord.start} icon={<BrandGlyph source="discord" size={16} />} />
          ) : null}
          {Platform.OS !== 'web' ? <Button label="Use a code instead" variant="ghost" size="lg" onPress={auth.startTraktCodeSignIn} /> : null}
        </View>
      )}
      {(withGoogle || withDiscord) && !busy ? (
        <Text style={type.caption}>
          Trakt brings what you have watched and rated there. {withGoogle && withDiscord ? 'Google and Discord only sign' : withGoogle ? 'Google only signs' : 'Discord only signs'} you in, and you can add Trakt later in Settings.
        </Text>
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
