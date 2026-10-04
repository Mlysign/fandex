// Your account on this device: signing in and out, and what the device holds.

import * as Clipboard from 'expo-clipboard';
import { useSQLiteContext } from 'expo-sqlite';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Divider, Screen, ScreenTitle, T } from '~/components/ui';
import { api } from '~/lib/api';
import { useAuth } from '~/lib/AuthProvider';
import { useCatalogSync } from '~/lib/CatalogSyncProvider';
import { API_URL } from '~/lib/config';
import { catalogCounts, shelfCounts } from '~/lib/db';
import { deviceRegion } from '~/lib/region';
import { activationUrl } from '~/lib/trakt';
import type { TraktSyncResult } from '~/lib/traktSync';
import { requestWidget, widgetAvailable } from '~/lib/widget';
import { color, font, radius, space } from '~/theme';

function Line({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={styles.line}>
      <T variant="caption">{label}</T>
      <T variant="label" style={tone ? { color: tone } : undefined}>{value}</T>
    </View>
  );
}

function ago(ms: number | null): string {
  if (!ms) return 'never';
  const minutes = Math.round((Date.now() - ms) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

const PROVIDER_NAME: Record<string, string> = { trakt: 'Trakt', google: 'Google', steam: 'Steam' };

function SignIn() {
  const auth = useAuth();
  const flow = auth.trakt;
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  if (flow.phase === 'waiting') {
    // The page opens with the code already filled in. On Android it opens in a
    // tab over the app, so closing it lands back here.
    const url = activationUrl(flow);
    const open = () => void (Platform.OS === 'web' ? Linking.openURL(url) : WebBrowser.openBrowserAsync(url));
    const copy = () => void Clipboard.setStringAsync(flow.userCode).then(() => setCopied(true));
    return (
      <View style={styles.card}>
        <T variant="serifSm">Confirm this code on Trakt</T>
        <T variant="caption">
          Open Trakt and the code is already filled in. Confirm it there and this screen carries on by itself. On another
          device, go to trakt.tv/activate and type it.
        </T>
        <Pressable
          onPress={copy}
          accessibilityRole="button"
          accessibilityLabel={`Code ${flow.userCode.split('').join(' ')}. Tap to copy.`}
          style={({ pressed }) => [styles.codeBox, pressed && { opacity: 0.6 }]}>
          <T variant="serifLg" style={styles.code}>{flow.userCode}</T>
          <T variant="meta" style={{ color: copied ? color.accent : color.textMuted }}>{copied ? 'Copied' : 'Tap to copy'}</T>
        </Pressable>
        <View style={styles.actions}>
          <Button label="Open Trakt" onPress={open} />
          <Button label="Cancel" onPress={auth.cancelTraktSignIn} quiet />
        </View>
        <View style={styles.waiting}>
          <ActivityIndicator size="small" color={color.accent} />
          <T variant="caption">Waiting for Trakt…</T>
        </View>
      </View>
    );
  }

  const busy = flow.phase === 'starting' || flow.phase === 'finishing';
  return (
    <View style={styles.card}>
      <T variant="serifSm">Sign in</T>
      <T variant="caption">
        Your library, ratings and wishlist live in your Fandex account. Sign in with Trakt to bring them to this device.
      </T>
      {flow.phase === 'error' ? <T variant="caption" style={{ color: color.danger }}>{flow.message}</T> : null}
      {busy ? (
        <View style={styles.waiting}>
          <ActivityIndicator size="small" color={color.accent} />
          <T variant="caption">{flow.phase === 'starting' ? 'Waiting for Trakt…' : 'Signing you in…'}</T>
        </View>
      ) : (
        <View style={styles.actions}>
          <Button label="Sign in with Trakt" onPress={auth.startTraktSignIn} />
          {/* The web build already signs in with a code, so there is nothing to fall back to. */}
          {Platform.OS !== 'web' ? <Button label="Use a code instead" onPress={auth.startTraktCodeSignIn} quiet /> : null}
        </View>
      )}
    </View>
  );
}

function Account() {
  const auth = useAuth();
  const db = useSQLiteContext();
  const [counts, setCounts] = useState({ library: 0, wishlist: 0, missing: 0 });

  useEffect(() => {
    void shelfCounts(db).then(setCounts);
  }, [db, auth.rowsRevision]);

  const names = (auth.profile?.identities ?? []).map((i) => PROVIDER_NAME[i.provider] ?? i.provider);
  const who = auth.profile?.identities.find((i) => i.displayName)?.displayName;

  return (
    <View style={styles.group}>
      <T variant="eyebrow">Your account</T>
      <Line label="Signed in" value={who ?? 'Yes'} />
      {names.length ? <Line label="Signs in with" value={names.join(', ')} /> : null}
      <Line label="Library" value={`${counts.library.toLocaleString('en')} titles`} />
      <Line label="Wishlist" value={`${counts.wishlist.toLocaleString('en')} titles`} />
      {auth.rowsSyncing ? <T variant="caption">Refreshing your library…</T> : null}
      {auth.rowsError ? <T variant="caption" style={{ color: color.warning }}>{auth.rowsError}</T> : null}
      {!auth.profile ? <T variant="caption">Offline. Showing what is on this device.</T> : null}
      <View style={styles.actions}>
        <Button label="Refresh library" onPress={auth.syncRows} quiet />
        <Button label="Sign out" onPress={() => void auth.signOut()} quiet />
      </View>
      <T variant="meta" style={{ color: color.textMuted }}>Signing out signs out every device on this account.</T>
      {names.includes('Trakt') ? <TraktSync /> : null}
    </View>
  );
}

/** What the last Trakt sync did, in one line. */
function traktSummary(r: TraktSyncResult): string {
  const changed = r.itemsChanged + r.episodesChanged;
  const removed = r.itemsRemoved + r.episodesRemoved;
  const parts = [
    changed ? `${changed.toLocaleString('en')} updated` : null,
    removed ? `${removed.toLocaleString('en')} removed` : null,
    r.deferred ? `${r.deferred.toLocaleString('en')} new titles waiting for the next sync` : null,
  ].filter(Boolean);
  const what = parts.length ? parts.join(', ') : 'Nothing had changed';
  return r.dryRun ? `Test run, nothing written. Would be: ${what.toLowerCase()}.` : `${what}.`;
}

function TraktSync() {
  const { traktSync, syncTraktNow, startTraktSignIn } = useAuth();
  return (
    <View style={styles.subgroup}>
      <T variant="eyebrow">Trakt</T>
      <Line
        label="Last synced"
        value={traktSync.running ? 'Syncing…' : ago(traktSync.syncedAt)}
        tone={traktSync.error ? color.warning : undefined}
      />
      {traktSync.last && !traktSync.running ? (
        <T variant="caption">
          {traktSync.last.library.toLocaleString('en')} watched, {traktSync.last.wishlist.toLocaleString('en')} on your watchlist,{' '}
          {traktSync.last.episodes.toLocaleString('en')} episodes. {traktSummary(traktSync.last)}
        </T>
      ) : null}
      {traktSync.error ? <T variant="caption" style={{ color: color.warning }}>{traktSync.error}</T> : null}
      <View style={styles.actions}>
        {traktSync.needsSignIn
          ? <Button label="Sign in to Trakt again" onPress={startTraktSignIn} />
          : <Button label="Sync Trakt now" onPress={syncTraktNow} quiet />}
      </View>
      <WidgetOffer />
    </View>
  );
}

/** The Up next home-screen widget. Android only; on the web there is nothing to offer. */
function WidgetOffer() {
  const [note, setNote] = useState<string | null>(null);
  if (!widgetAvailable) return null;
  return (
    <View style={styles.subgroup}>
      <T variant="eyebrow">Home screen</T>
      <T variant="caption">
        The Up next widget shows the next episode of each show you are watching, with a tick that marks it watched.
      </T>
      <View style={styles.actions}>
        <Button
          label="Add the Up next widget"
          quiet
          onPress={() => setNote(requestWidget()
            ? null
            : 'This home screen cannot add it for you. Long-press the home screen, open Widgets, and pick Fandex.')}
        />
      </View>
      {note ? <T variant="caption" style={{ color: color.warning }}>{note}</T> : null}
    </View>
  );
}

export default function YouScreen() {
  const db = useSQLiteContext();
  const auth = useAuth();
  const sync = useCatalogSync();
  const region = useMemo(deviceRegion, []);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [server, setServer] = useState<'checking' | 'up' | 'down'>('checking');

  useEffect(() => {
    void catalogCounts(db).then(setCounts);
  }, [db, sync.revision, sync.state]);

  useEffect(() => {
    let live = true;
    api.health()
      .then(() => { if (live) setServer('up'); })
      .catch(() => { if (live) setServer('down'); });
    return () => { live = false; };
  }, []);

  const status =
    sync.state === 'syncing' ? `Syncing… ${sync.written.toLocaleString('en')} written`
    : sync.state === 'error' ? 'Last sync failed'
    : `Up to date, checked ${ago(sync.syncedAt)}`;

  return (
    <Screen>
      <ScreenTitle title="You" />
      <ScrollView contentContainerStyle={styles.scroll}>
        {auth.status === 'loading' ? (
          <View style={styles.group}><ActivityIndicator color={color.accent} /></View>
        ) : auth.status === 'signedIn' ? (
          <Account />
        ) : (
          <SignIn />
        )}

        <Divider />

        <View style={styles.group}>
          <T variant="eyebrow">Catalog on this device</T>
          <Line label="Titles" value={sync.total.toLocaleString('en')} />
          <Line label="Games" value={(counts.game ?? 0).toLocaleString('en')} />
          <Line label="Films" value={(counts.movie ?? 0).toLocaleString('en')} />
          <Line label="Shows" value={(counts.show ?? 0).toLocaleString('en')} />
          <Line label="Status" value={status} tone={sync.state === 'error' ? color.danger : undefined} />
          {sync.error ? <T variant="caption">{sync.error}</T> : null}
          <View style={styles.actions}>
            <Button label="Check for changes" onPress={sync.sync} quiet />
            <Button label="Download again" onPress={sync.resync} quiet />
          </View>
        </View>

        <Divider />

        <View style={styles.group}>
          <T variant="eyebrow">This device</T>
          <Line label="Release dates for" value={region} />
          <Line
            label="Catalog server"
            value={server === 'checking' ? 'Checking…' : server === 'up' ? 'Reachable' : 'Not reachable'}
            tone={server === 'down' ? color.danger : undefined}
          />
          <T variant="meta" style={{ color: color.textMuted }}>{API_URL.replace(/^https?:\/\//, '')}</T>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: space.section },
  card: {
    margin: space.lg, padding: space.lg, gap: space.md, borderRadius: radius.lg,
    backgroundColor: color.surfaceElevated, borderWidth: 1, borderColor: color.border,
  },
  codeBox: {
    alignItems: 'center', gap: space.xs, paddingVertical: space.lg, borderRadius: radius.md,
    backgroundColor: color.surfaceInset, borderWidth: 1, borderColor: color.borderStrong,
  },
  code: { fontFamily: font.mono, letterSpacing: 6, color: color.accent },
  waiting: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  group: { padding: space.lg, gap: space.sm },
  subgroup: { paddingTop: space.lg, gap: space.sm },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md, minHeight: 28 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingTop: space.xs },
});
