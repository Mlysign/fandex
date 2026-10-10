// The sign-in card. Trakt is the one way in today (Google is next, docs/app.md).
// On a phone the button opens Trakt's own page and comes back signed in. In a
// browser Trakt gives a short code to confirm on its site; the code is filled in
// for you when you open Trakt from here, and a tap copies it.

import * as Clipboard from 'expo-clipboard';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { BrandGlyph } from '~/components/BrandGlyph';
import { Button, Panel } from '~/components/kit';
import { useAuth } from '~/lib/AuthProvider';
import { activationUrl } from '~/lib/trakt';
import { color, font, radius, space, type } from '~/theme';

export function SignIn({ title = 'Sign in', hint }: { title?: string; hint?: string }) {
  const auth = useAuth();
  const flow = auth.trakt;
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  if (flow.phase === 'waiting') {
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

  const busy = flow.phase === 'starting' || flow.phase === 'finishing';
  return (
    <Panel style={styles.card}>
      <Text style={type.serifMd}>{title}</Text>
      <Text style={type.bodySm}>
        {hint ?? 'Your library, ratings and wishlist live in your Fandex account. Sign in with Trakt to bring them to this device.'}
      </Text>
      {flow.phase === 'error' ? <Text style={[type.caption, { color: color.danger }]}>{flow.message}</Text> : null}
      {busy ? (
        <View style={styles.waiting}>
          <ActivityIndicator size="small" color={color.accent} />
          <Text style={type.caption}>{flow.phase === 'starting' ? 'Waiting for Trakt…' : 'Signing you in…'}</Text>
        </View>
      ) : (
        <View style={styles.actions}>
          <Button
            label="Continue with Trakt" variant="secondary" size="lg" onPress={auth.startTraktSignIn}
            icon={<BrandGlyph source="trakt" size={16} />}
          />
          {Platform.OS !== 'web' ? <Button label="Use a code instead" variant="ghost" size="lg" onPress={auth.startTraktCodeSignIn} /> : null}
        </View>
      )}
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
