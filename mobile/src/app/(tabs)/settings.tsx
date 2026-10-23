// Settings. A port of the site's src/app/settings/SettingsPageClient.tsx and its
// pickers (src/components/settings/), section for section: connected accounts,
// region, default types, account, your data.
//
// Joining two accounts (MergePanel) since 2026-10-17. Kept from the app: the widget offer and what this device
// holds, which the site had no use for.
import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Check, ChevronDown, Clapperboard, Gamepad2, Tv } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { COUNTRIES } from '@/lib/countries';
import { MEDIA_TYPES, MEDIA_TYPE_LABELS, enabledMediaTypes } from '@/lib/mediaTypes';
import { platformMarkName, type PlatformOption } from '@/lib/platformKeys';
import { BrandGlyph } from '~/components/BrandGlyph';
import { GoogleMark } from '~/components/GoogleMark';
import { Button, Sheet } from '~/components/kit';
import { LegalLinks } from '~/components/LegalLinks';
import { SignIn, TraktCodeCard, useDiscordSignIn, useGoogleSignIn } from '~/components/SignIn';
import { useToast } from '~/components/Toast';
import { Screen, T } from '~/components/ui';
import { toggled } from '~/lib/a11y';
import { foldAt } from '~/lib/foldAt';
import { TYPE_ICONS } from '~/lib/typeIcons';
import { useOfferedTypes } from '~/lib/features';
import { api, ApiError, type MergeResolution, type MergeSide } from '~/lib/api';
import { usePageTitle } from '~/lib/pageTitle';
import { useAuth } from '~/lib/AuthProvider';
import { useCatalogSync } from '~/lib/CatalogSyncProvider';
import { API_URL, LOCAL_API } from '~/lib/config';
import { catalogCounts, shelfCounts } from '~/lib/db';
import { saveJsonFile } from '~/lib/files';
import { discordAvailable } from '~/lib/discord';
import { googleAvailable } from '~/lib/google';
import { shelfItemIds, usePlatformIndex } from '~/lib/platforms';
import type { SteamSyncResult } from '~/lib/steamSync';
import type { TraktSyncResult } from '~/lib/traktSync';
import { useTypeFilter } from '~/lib/typeFilter';
import { requestWidget, widgetAvailable } from '~/lib/widget';
import { count } from '~/lib/plural';
import { color, font, radius, space, TYPE_PLURAL } from '~/theme';

type Notice = { msg: string; ok: boolean } | null;

const PROVIDER_NAME: Record<string, string> = { trakt: 'Trakt', google: 'Google', discord: 'Discord', steam: 'Steam' };
const TYPE_ICON = TYPE_ICONS;

function ago(ms: number | null): string {
  if (!ms) return 'never';
  const minutes = Math.round((Date.now() - ms) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

function traktSummary(r: TraktSyncResult): string {
  const changed = r.itemsChanged + r.episodesChanged;
  const removed = r.itemsRemoved + r.episodesRemoved;
  const parts = [
    changed ? `${changed.toLocaleString('en')} updated` : null,
    removed ? `${removed.toLocaleString('en')} removed` : null,
    r.deferred ? `${count(r.deferred, 'new title')} waiting for the next sync` : null,
    r.watchlistTidied ? `${count(r.watchlistTidied, 'rated title')} taken off your Trakt watchlist` : null,
    r.wishlistTidied ? `${count(r.wishlistTidied, 'rated title')} taken off your wishlist` : null,
  ].filter(Boolean);
  const what = parts.length ? parts.join(', ') : 'Nothing had changed';
  return r.dryRun ? `Test run, nothing written. Would be: ${what.toLowerCase()}.` : `${what}.`;
}

function steamSummary(r: SteamSyncResult): string {
  const parts = [
    r.itemsChanged ? `${r.itemsChanged.toLocaleString('en')} updated` : null,
    r.itemsRemoved ? `${r.itemsRemoved.toLocaleString('en')} removed` : null,
    r.deferred ? `${count(r.deferred, 'new title')} waiting for the next sync` : null,
    r.unmatched ? `${count(r.unmatched, 'app')} with no game in the catalog` : null,
  ].filter(Boolean);
  return `${parts.length ? parts.join(', ') : 'Nothing had changed'}.`;
}

/** Why a save did not happen, in words. */
function failure(e: unknown, fallback: string): string {
  if (e instanceof ApiError && e.code === 'offline') return 'No connection. Nothing was changed.';
  if (e instanceof ApiError && e.code === 'budget-exhausted') return 'Fandex cannot save more changes until tomorrow.';
  return fallback;
}

// ── Parts ────────────────────────────────────────────────────────────────────

function Section({ eyebrow, hint, children }: { eyebrow: string; hint?: string; children?: ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <T variant="eyebrow" style={{ color: color.accent }}>{eyebrow}</T>
        {hint ? <T variant="bodySm" style={styles.hint}>{hint}</T> : null}
      </View>
      {children}
    </View>
  );
}

function Card({ children, danger, row }: { children: ReactNode; danger?: boolean; row?: boolean }) {
  return <View style={[styles.card, row && styles.cardRow, danger && styles.cardDanger]}>{children}</View>;
}

function RowText({ title, text, danger }: { title: string; text: string; danger?: boolean }) {
  return (
    <View style={styles.rowText}>
      <T variant="body" style={[styles.rowTitle, danger && { color: color.danger }]}>{title}</T>
      <T variant="bodySm">{text}</T>
    </View>
  );
}

function Line({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={styles.line}>
      <T variant="body" style={{ color: color.textSecondary }}>{label}</T>
      <T variant="body" style={tone ? { color: tone } : undefined}>{value}</T>
    </View>
  );
}

// ── Connected accounts ───────────────────────────────────────────────────────

/** The site's provider list (SettingsPageClient.tsx), for the ones this stack knows. */
const PROVIDERS: Record<string, { label: string; description: string; identityOnly?: boolean; readOnly?: boolean }> = {
  google: { label: 'Google', description: 'Signs you in. No library to import.', identityOnly: true },
  discord: { label: 'Discord', description: 'Signs you in. No library to import.', identityOnly: true },
  trakt: { label: 'Trakt.tv', description: 'Movies & TV shows watchlist' },
  steam: { label: 'Steam', description: 'Your games and wishlist', readOnly: true },
};

function ProviderPanel({ provider, onNotice }: { provider: string; onNotice: (n: Notice) => void }) {
  const auth = useAuth();
  const { traktSync, steamSync } = auth;
  const meta = PROVIDERS[provider] ?? { label: provider, description: '' };
  const identity = auth.profile?.identities.find((i) => i.provider === provider);
  const [asking, setAsking] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const disconnect = () => {
    setAsking(false);
    setDisconnecting(true);
    auth.disconnect(provider)
      .then(() => onNotice({ msg: `${meta.label} disconnected.`, ok: true }))
      .catch((e: unknown) => onNotice({
        ok: false,
        msg: e instanceof ApiError && e.code === 'only-login'
          ? `${meta.label} is the only way you sign in to this account, so it cannot be disconnected. To leave Fandex, delete your account below.`
          : failure(e, `Could not disconnect ${meta.label}. Nothing was changed.`),
      }))
      .finally(() => setDisconnecting(false));
  };

  return (
    <Card>
      <View style={styles.provider}>
        <View style={styles.providerWho}>
          <View style={styles.glyph}>
            {provider === 'google' ? <GoogleMark size={18} /> : <BrandGlyph source={provider} size={18} />}
          </View>
          <View style={styles.rowText}>
            <T variant="body" style={styles.rowTitle} numberOfLines={1}>{meta.label}</T>
            <T variant="bodySm" numberOfLines={1}>
              {identity?.displayName ? `@${identity.displayName}` : meta.description}
            </T>
          </View>
        </View>
        <View style={styles.providerActions}>
          <View style={styles.connected}><T variant="caption" style={{ color: color.success }}>Connected</T></View>
          {provider !== 'trakt' ? null : traktSync.onDevice === false
            ? <Button label="Sign in to Trakt" onPress={auth.startTraktSignIn} />
            : traktSync.needsSignIn
            ? <Button label="Sign in again" onPress={auth.startTraktSignIn} />
            : <Button label={traktSync.running ? 'Syncing...' : 'Sync'} onPress={auth.syncTraktNow} disabled={traktSync.running} />}
          {provider === 'steam'
            ? <Button label={steamSync.running ? 'Syncing...' : 'Sync'} onPress={auth.syncSteamNow} disabled={steamSync.running} />
            : null}
          <Button label={disconnecting ? '...' : 'Disconnect'} variant="danger" onPress={() => setAsking(true)} disabled={disconnecting} />
        </View>
      </View>
      {provider === 'trakt' && traktSync.onDevice === false ? (
        <T variant="bodySm">
          Your account is connected to Trakt, but {Platform.OS === 'web' ? 'this browser' : 'this device'} is
          not signed in to it yet. Sign in once and it stays signed in here until you sign out. Trakt keeps
          that sign-in on each device, never on Fandex's server, so every browser and phone needs its own.
        </T>
      ) : provider === 'trakt' ? (
        <>
          <T variant="bodySm">
            Last synced {traktSync.running ? 'now' : ago(traktSync.syncedAt)}
            {traktSync.last && !traktSync.running
              ? ` · ${traktSync.last.library.toLocaleString('en')} watched, ${traktSync.last.wishlist.toLocaleString('en')} on your watchlist, ${traktSync.last.episodes.toLocaleString('en')} episodes. ${traktSummary(traktSync.last)}`
              : ''}
          </T>
          {traktSync.error ? <T variant="bodySm" style={{ color: color.warning }}>{traktSync.error}</T> : null}
        </>
      ) : null}
      {provider === 'steam' ? (
        <>
          <T variant="bodySm">
            Last synced {steamSync.running ? 'now' : ago(steamSync.syncedAt)}
            {steamSync.last && !steamSync.running
              ? ` · ${steamSync.last.library.toLocaleString('en')} owned, ${steamSync.last.wishlist.toLocaleString('en')} on your wishlist. ${steamSummary(steamSync.last)}`
              : ''}
          </T>
          {steamSync.error ? <T variant="bodySm" style={{ color: color.warning }}>{steamSync.error}</T> : null}
        </>
      ) : null}
      {meta.readOnly ? (
        <T variant="bodySm">
          Read-only. {meta.label} doesn’t support adding to a wishlist via its API, so Fandex only reads your games
          and wishlist. Your Steam profile’s Game details have to be public for that.
        </T>
      ) : null}
      {meta.identityOnly ? (
        <T variant="bodySm">
          {/* Discord signs in on a phone too (lib/discord.ts); Google does not yet (docs/app.md). */}
          {Platform.OS === 'web' || provider === 'discord'
            ? 'A way to sign in. It holds no library.'
            : 'Signs you in on fandex.org. It holds no library.'}
        </T>
      ) : null}

      <Sheet open={asking} onClose={() => setAsking(false)} title={`Disconnect ${meta.label}?`}>
        <View style={styles.sheetBody}>
          <T variant="serifMd">Disconnect {meta.label}?</T>
          <T variant="bodySm">
            {meta.identityOnly
              ? `You will no longer be able to sign in with ${meta.label}.`
              : 'Items from this source will be removed from your library and wishlist here. Nothing changes on the provider.'}
          </T>
          <View style={styles.sheetActions}>
            <Button label="Disconnect" variant="danger" size="md" onPress={disconnect} style={{ flex: 1 }} />
            <Button label="Cancel" variant="outline" size="md" onPress={() => setAsking(false)} />
          </View>
        </View>
      </Sheet>
    </Card>
  );
}

// ── Joining two accounts ─────────────────────────────────────────────────────

/**
 * A port of the site's src/components/settings/MergePanel.tsx (2026-09-02, Nils:
 * "it should give me a merge form for me to decide and then execute the merge
 * right after"). It shows when a way in the person just added belongs to another
 * Fandex account and both hold some of the same titles. Everything that does not
 * overlap moves either way; the form is only about the titles both hold.
 *
 * ⚠️ NO OPTION IS PRESELECTED, and that is the point. A default would be the
 * silent winner-picking the whole flow exists to replace.
 */
function SideCard({ side, label }: { side: MergeSide; label: string }) {
  const name = PROVIDER_NAME[side.provider] ?? side.provider;
  return (
    <View style={styles.side}>
      <T variant="eyebrow" style={{ color: color.textSecondary }}>{label}</T>
      <View style={styles.sideWho}>
        {side.provider === 'google' ? <GoogleMark size={15} /> : <BrandGlyph source={side.provider} size={15} />}
        <T variant="body" style={styles.rowTitle} numberOfLines={1}>{side.displayName ?? name}</T>
      </View>
      <T variant="bodySm">
        {count(side.titles, 'title')}{side.episodes > 0 ? `, ${count(side.episodes, 'episode')}` : ''}
      </T>
      {side.providers.length > 0 ? (
        <T variant="meta" style={{ color: color.textMuted }} numberOfLines={1}>
          {side.providers.map((p) => PROVIDER_NAME[p] ?? p).join(', ')}
        </T>
      ) : null}
    </View>
  );
}

function MergePanel({ onNotice }: { onNotice: (n: Notice) => void }) {
  const auth = useAuth();
  const pending = auth.pendingMerge;
  const [busy, setBusy] = useState<MergeResolution | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!pending) return null;

  const { conflicts, mine, theirs } = pending;
  const provider = PROVIDER_NAME[pending.provider] ?? pending.provider;
  const overlap = conflicts.itemState + conflicts.episodeState;

  const choose = (resolution: MergeResolution) => {
    setBusy(resolution);
    setError(null);
    auth.completeMerge(resolution)
      .then(() => onNotice({ msg: 'The accounts are now one, and everything from both is here.', ok: true }))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'The accounts were not joined. Nothing was changed.'))
      .finally(() => setBusy(null));
  };

  // The Worker asks before folding away an account that holds titles, even when
  // nothing overlaps: then there is nothing to pick, only a yes to give.
  if (overlap === 0) {
    return (
      <Section
        eyebrow="Join these accounts"
        hint={`The ${provider} account you just connected belongs to another Fandex account. Join them to have everything in one.`}
      >
        <View style={[styles.card, styles.cardWarning]}>
          <View style={styles.sides}>
            <SideCard side={mine} label="Signed in as" />
            <SideCard side={theirs} label="The other account" />
          </View>
          <T variant="bodySm">
            <T variant="bodySm" style={styles.strong}>{conflicts.cleanRows.toLocaleString('en')}</T>
            {conflicts.cleanRows === 1 ? ' entry moves' : ' entries move'} across. Nothing exists on both, so nothing is lost.
          </T>
          {error ? <T variant="bodySm" style={{ color: color.danger }}>{error}</T> : null}
          <View style={styles.actions}>
            <Button label="Join the accounts" size="md" onPress={() => choose('keep-theirs')} loading={busy === 'keep-theirs'} disabled={!!busy} />
          </View>
          <Pressable onPress={auth.cancelMerge} disabled={!!busy} accessibilityRole="button" style={styles.textButton}>
            <T variant="bodySm" style={{ color: color.textSecondary }}>Not now, keep them separate</T>
          </Pressable>
        </View>
      </Section>
    );
  }

  return (
    <Section
      eyebrow="Join these accounts"
      hint={`The ${provider} account you just connected belongs to another Fandex account. Both have titles saved, so you decide what wins.`}
    >
      <View style={[styles.card, styles.cardWarning]}>
        <View style={styles.sides}>
          <SideCard side={mine} label="Signed in as" />
          <SideCard side={theirs} label="The other account" />
        </View>
        <T variant="bodySm">
          <T variant="bodySm" style={styles.strong}>{conflicts.cleanRows.toLocaleString('en')}</T>
          {conflicts.cleanRows === 1 ? ' entry moves' : ' entries move'} across with nothing to decide.
        </T>
        <T variant="bodySm">
          <T variant="bodySm" style={styles.strong}>{overlap.toLocaleString('en')}</T>
          {overlap === 1 ? ' entry exists' : ' entries exist'} on both accounts. Pick which copy to keep for those.
        </T>
        {conflicts.sampleTitles.length > 0 ? (
          <T variant="meta" style={{ color: color.textMuted }}>
            For example: {conflicts.sampleTitles.join(', ')}{conflicts.itemState > conflicts.sampleTitles.length ? ', and others' : ''}.
          </T>
        ) : null}
        {error ? <T variant="bodySm" style={{ color: color.danger }}>{error}</T> : null}
        <View style={styles.actions}>
          <Button label="Keep this account's copies" size="md" onPress={() => choose('keep-mine')} loading={busy === 'keep-mine'} disabled={!!busy} />
          <Button label="Keep the other account's copies" size="md" onPress={() => choose('keep-theirs')} loading={busy === 'keep-theirs'} disabled={!!busy} />
        </View>
        <T variant="meta" style={{ color: color.textMuted }}>
          Either way both accounts become one and nothing else is lost. Only the overlapping entries above are affected.
        </T>
        {/* Not in the site's panel, whose decision lived in a cookie that ran out on its own. Here it is held in memory. */}
        <Pressable onPress={auth.cancelMerge} disabled={!!busy} accessibilityRole="button" style={styles.textButton}>
          <T variant="bodySm" style={{ color: color.textSecondary }}>Not now, keep them separate</T>
        </Pressable>
      </View>
    </Section>
  );
}

/**
 * A way in that this account does not have yet. Signing in with it while signed
 * in adds it to the account (the Worker links it to whoever the session is).
 * This is what lets an account made with Google get its Trakt library, without
 * signing out and ending up with two accounts.
 */
function AddProvider({ provider }: { provider: 'trakt' | 'google' | 'discord' }) {
  const auth = useAuth();
  const google = useGoogleSignIn();
  const discord = useDiscordSignIn();
  const meta = PROVIDERS[provider];
  const flow = auth.trakt;
  const traktBusy = provider === 'trakt' && (flow.phase === 'starting' || flow.phase === 'finishing');
  const busy = traktBusy || (provider === 'google' && google.leaving) || (provider === 'discord' && discord.leaving);
  const error = provider === 'trakt' ? (flow.phase === 'error' ? flow.message : null) : provider === 'discord' ? discord.error : google.error;

  if (provider === 'trakt' && flow.phase === 'waiting') return <TraktCodeCard />;
  return (
    <Card>
      <View style={styles.provider}>
        <View style={styles.providerWho}>
          <View style={styles.glyph}>
            {provider === 'google' ? <GoogleMark size={18} /> : <BrandGlyph source={provider} size={18} />}
          </View>
          <View style={styles.rowText}>
            <T variant="body" style={styles.rowTitle} numberOfLines={1}>{meta.label}</T>
            <T variant="bodySm" numberOfLines={1}>{meta.description}</T>
          </View>
        </View>
        <View style={styles.providerActions}>
          <Button
            label={busy ? '...' : 'Connect'} disabled={busy}
            onPress={provider === 'trakt' ? auth.startTraktSignIn : provider === 'discord' ? discord.start : google.start}
          />
        </View>
      </View>
      {error ? <T variant="bodySm" style={{ color: color.danger }}>{error}</T> : null}
    </Card>
  );
}

// ── Region ───────────────────────────────────────────────────────────────────

function Region({ onNotice }: { onNotice: (n: Notice) => void }) {
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const stored = auth.profile?.user.country ?? null;

  const save = (code: string, quiet = false) => {
    setOpen(false);
    setSaving(true);
    auth.savePrefs({ country: code })
      .then(() => { if (!quiet) onNotice({ msg: 'Region updated.', ok: true }); })
      .catch((e: unknown) => onNotice({ msg: failure(e, 'Could not save your region. Please try again.'), ok: false }))
      .finally(() => setSaving(false));
  };

  // The first visit writes down the country the device reports, as the site did,
  // so every device on this account then agrees.
  const profileLoaded = auth.profile != null;
  useEffect(() => {
    if (profileLoaded && !stored) save(auth.region, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileLoaded]);

  const name = COUNTRIES.find((c) => c.code === auth.region)?.name ?? auth.region;
  return (
    <Section eyebrow="Region" hint="Controls which release dates and streaming availability you see.">
      <Card row>
        <RowText title="Country" text="Release dates and “where to watch” use this region." />
        <Pressable
          onPress={() => setOpen(true)}
          disabled={saving || !profileLoaded}
          accessibilityRole="button"
          accessibilityLabel="Country"
          style={[styles.select, (saving || !profileLoaded) && { opacity: 0.5 }]}
        >
          <T variant="body" numberOfLines={1}>{name}</T>
          <ChevronDown size={14} color={color.textSecondary} />
        </Pressable>
      </Card>
      <Sheet open={open} onClose={() => setOpen(false)} title="Country">
        <ScrollView style={styles.countries} contentContainerStyle={{ paddingVertical: space.sm }}>
          {COUNTRIES.map((c) => (
            <Pressable key={c.code} onPress={() => save(c.code)} accessibilityRole="button" style={styles.country}>
              <T variant="body" style={{ flex: 1 }}>{c.name}</T>
              {c.code === auth.region ? <Check size={16} color={color.accent} /> : null}
            </Pressable>
          ))}
        </ScrollView>
      </Sheet>
    </Section>
  );
}

// ── Default types ────────────────────────────────────────────────────────────

function DefaultTypes({ onNotice }: { onNotice: (n: Notice) => void }) {
  const auth = useAuth();
  const filter = useTypeFilter();
  const value = auth.profile?.user.mediaTypes ?? null;
  const [selected, setSelected] = useState(enabledMediaTypes(value));
  const [saving, setSaving] = useState(false);
  const offered = useOfferedTypes();
  const [error, setError] = useState<string | null>(null);
  const valueKey = (value ?? []).join(',');
  useEffect(() => {
    setSelected(enabledMediaTypes(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valueKey]);

  const toggle = (t: (typeof MEDIA_TYPES)[number]) => {
    const next = selected.includes(t) ? selected.filter((x) => x !== t) : [...selected, t];
    if (next.length === 0) {
      setError('Keep at least one. Fandex has nothing to show otherwise.');
      return;
    }
    setError(null);
    setSelected(next);
    setSaving(true);
    auth.savePrefs({ mediaTypes: next })
      .then(() => {
        // The chip row remembers a selection on this device, and a selection wins
        // over the default. Dropping it is what makes the new default show.
        filter.reset();
        onNotice({ msg: 'Default types updated.', ok: true });
      })
      .catch((e: unknown) => {
        setSelected(enabledMediaTypes(value));
        onNotice({ msg: failure(e, 'Could not save what you track. Please try again.'), ok: false });
      })
      .finally(() => setSaving(false));
  };

  const allOn = offered.every((t) => selected.includes(t));
  return (
    <Section
      eyebrow="Default types"
      hint="Which types every list starts with. You can still switch one on from the filter row any time."
    >
      <Card>
        <View style={styles.chips}>
          {offered.map((t) => {
            const Icon = TYPE_ICON[t];
            const on = selected.includes(t);
            return (
              <Pressable
                key={t}
                onPress={() => toggle(t)}
                disabled={saving}
                accessibilityRole="button"
                {...toggled(on)}
                style={[styles.chip, on && styles.chipOn]}
              >
                <Icon size={16} color={on ? color.textPrimary : color.textMuted} />
                <T variant="label" style={{ color: on ? color.textPrimary : color.textMuted }}>{MEDIA_TYPE_LABELS[t]}</T>
              </Pressable>
            );
          })}
        </View>
        {error ? <T variant="caption" style={{ color: color.danger }}>{error}</T> : null}
        <T variant="bodySm">
          {allOn
            ? 'Every list starts with all three.'
            : `Off by default: ${offered.filter((t) => !selected.includes(t)).map((t) => MEDIA_TYPE_LABELS[t]).join(', ')}. Nothing is deleted or hidden for good. Tap the type in any list's filter row to bring it back for that visit.`}
          {saving ? ' Saving…' : ''}
        </T>
      </Card>
    </Section>
  );
}

// ── Your platforms ───────────────────────────────────────────────────────────


function PlatformGroup({ label, items, selected, onToggle, collapsible }: {
  label: string; items: PlatformOption[]; selected: string[]; onToggle: (key: string) => void; collapsible: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const { width } = useWindowDimensions();
  const tops = useRef<number[]>([]);
  // The cut for this order and this width. Measured again when either changes.
  const [cut, setCut] = useState<{ key: string; at: number | null } | null>(null);
  // Selected first, in the order they had when the group was last opened or
  // closed: a chip must not jump away under the finger that just tapped it.
  const orderKey = `${items.map((o) => o.key).join('|')}|${expanded}`;
  const order = useMemo(() => {
    const picked = new Set(selected);
    return [...items.filter((o) => picked.has(o.key)), ...items.filter((o) => !picked.has(o.key))];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderKey]);
  const measureKey = `${orderKey}|${width}`;
  const measured = cut?.key === measureKey ? cut : null;
  if (items.length === 0) return null;
  const collapsed = collapsible && !expanded;
  const shown = collapsed && measured?.at != null ? order.slice(0, measured.at) : order;
  const measuring = collapsed && !measured;
  const place = (i: number, y: number) => {
    tops.current[i] = y;
    if (!measuring || tops.current.filter((t) => t != null).length < order.length) return;
    setCut({ key: measureKey, at: foldAt(tops.current.slice(0, order.length)) });
  };
  return (
    <View style={{ gap: space.sm }}>
      <T variant="meta">{label}</T>
      <View style={styles.platformChips}>
        {shown.map((o) => {
          const on = selected.includes(o.key);
          return (
            <Pressable
              key={o.key} onPress={() => onToggle(o.key)} accessibilityRole="button" {...toggled(on)}
              onLayout={measuring ? (e) => place(order.indexOf(o), e.nativeEvent.layout.y) : undefined}
              style={[styles.platformChip, on && styles.chipOn]}
            >
              <BrandGlyph source={platformMarkName(o.label)} size={16} tint={on ? color.textPrimary : color.textSecondary} />
              <T variant="label" style={{ color: on ? color.textPrimary : color.textSecondary }} numberOfLines={1}>{o.label}</T>
              <T variant="meta" style={{ color: color.textMuted }}>{o.count}</T>
            </Pressable>
          );
        })}
      </View>
      {collapsible && (expanded || measured?.at != null) ? (
        <Pressable onPress={() => setExpanded((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded }} style={styles.textButton}>
          <T variant="label" style={{ color: color.accent }}>{expanded ? 'Show fewer' : `Show all ${items.length}`}</T>
        </Pressable>
      ) : null}
    </View>
  );
}

function YourPlatforms({ onNotice }: { onNotice: (n: Notice) => void }) {
  const db = useSQLiteContext();
  const auth = useAuth();
  const index = usePlatformIndex();
  const value = auth.profile?.user.platforms ?? null;
  const [selected, setSelected] = useState<string[]>(value ?? []);
  const [options, setOptions] = useState<PlatformOption[] | null>(null);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<string[]>(value ?? []);

  const valueKey = (value ?? []).join(',');
  useEffect(() => {
    setSelected(value ?? []);
    latest.current = value ?? [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valueKey]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  // What your library and wishlist are on: the survey the site ran on its server.
  useEffect(() => {
    let live = true;
    if (!index) return;
    void shelfItemIds(db).then((ids) => { if (live) setOptions(index.optionsFor(ids)); });
    return () => { live = false; };
  }, [db, index, auth.rowsRevision]);

  const save = (next: string[], wait: number) => {
    latest.current = next;
    setSelected(next);
    if (timer.current) clearTimeout(timer.current);
    setSaving(true);
    timer.current = setTimeout(() => {
      auth.savePrefs({ platforms: next })
        .then(() => onNotice({ msg: next.length ? 'Platforms updated.' : 'Platform filter reset to show everything.', ok: true }))
        .catch((e: unknown) => {
          setSelected(value ?? []);
          latest.current = value ?? [];
          onNotice({ msg: failure(e, 'Could not save your platforms. Please try again.'), ok: false });
        })
        .finally(() => setSaving(false));
    }, wait);
  };
  const toggle = (key: string) => {
    const current = latest.current;
    save(current.includes(key) ? current.filter((k) => k !== key) : [...current, key], 500);
  };

  const q = query.trim().toLowerCase();
  const shown = (options ?? []).filter((o) => !q || o.label.toLowerCase().includes(q));
  return (
    <Section eyebrow="Your platforms" hint="Pick what you subscribe to and own. The “Available on” filter then offers only these.">
      <Card>
        {!options ? (
          <T variant="bodySm">Reading your library…</T>
        ) : options.length === 0 ? (
          <T variant="bodySm">
            Nothing in your library says where it can be watched or played yet. Sync an account, or add a few titles, and
            the services they are on will show up here.
          </T>
        ) : (
          <>
            <View style={styles.platformHead}>
              <T variant="bodySm" style={{ flex: 1 }}>
                {/* No number for "everything": these are the services YOUR titles are on, and
                    the filter with nothing picked offers every service in the catalog (SM73). */}
                {selected.length === 0 ? 'Nothing selected, so the filter offers every service.' : `${selected.length} of ${options.length} selected.`}
                {saving ? ' Saving…' : ''}
              </T>
              {selected.length > 0 ? (
                <Pressable onPress={() => save([], 0)} accessibilityRole="button" style={styles.textButton}>
                  <T variant="label" style={{ color: color.accent }}>Clear</T>
                </Pressable>
              ) : null}
            </View>
            {options.length > 12 ? (
              <TextInput
                value={query} onChangeText={setQuery} placeholder="Find a service or console…" placeholderTextColor={color.textSecondary}
                accessibilityLabel="Find a service or console" autoCapitalize="none" autoCorrect={false} style={[styles.input, { minHeight: 44 }]}
              />
            ) : null}
            {shown.length === 0 ? <T variant="bodySm">Nothing matches “{query}”.</T> : (
              <View style={{ gap: space.lg }}>
                <PlatformGroup label="Movies & shows" items={shown.filter((o) => o.group === 'streaming')} selected={selected} onToggle={toggle} collapsible={!q} />
                <PlatformGroup label="Games" items={shown.filter((o) => o.group === 'games')} selected={selected} onToggle={toggle} collapsible={!q} />
              </View>
            )}
          </>
        )}
      </Card>
    </Section>
  );
}

// ── Your data ────────────────────────────────────────────────────────────────

function YourData({ onNotice, counts }: { onNotice: (n: Notice) => void; counts: { library: number; wishlist: number } }) {
  const auth = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const [exporting, setExporting] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);

  const exportData = () => {
    setExporting(true);
    api.exportAccount()
      // In a browser a download; on a phone the share sheet, where it saves to Files or Drive.
      .then((data) => saveJsonFile(`fandex-export-${new Date().toISOString().slice(0, 10)}.json`, data))
      .then(() => onNotice({ msg: Platform.OS === 'web' ? 'Your data export has been downloaded.' : 'Your data export is ready.', ok: true }))
      .catch((e: unknown) => onNotice({ msg: failure(e, 'Could not prepare your export. Please try again.'), ok: false }))
      .finally(() => setExporting(false));
  };

  const deleteAccount = () => {
    setDeleting(true);
    auth.deleteAccount()
      .then(() => {
        // This screen is gone a moment later, so its own notice line would
        // never be read. The toast lives above every screen (SM75).
        toast('Your account and everything in it have been deleted.', 'success');
        router.replace('/' as never);
      })
      .catch((e: unknown) => {
        setShowDelete(false);
        onNotice({ msg: failure(e, 'Could not delete your account. Nothing was changed.'), ok: false });
      })
      .finally(() => setDeleting(false));
  };

  const held: [string, number][] = [
    ['Library entries (with your ratings and reviews)', counts.library],
    ['Wishlist entries', counts.wishlist],
  ];
  return (
    <Section eyebrow="Your data">
      <Card row>
        <RowText
          title="Download your data"
          text="Everything Fandex stores about you, as a JSON file: library, wishlist, ratings and connected accounts."
        />
        <Button label={exporting ? 'Preparing...' : 'Download'} onPress={exportData} disabled={exporting} />
      </Card>
      <Card row danger>
        <RowText danger title="Delete your account" text="Permanently removes your account and everything in it. This cannot be undone." />
        <Button label="Delete" variant="danger" onPress={() => { setConfirm(''); setShowDelete(true); }} />
      </Card>

      <Sheet open={showDelete} onClose={() => { if (!deleting) setShowDelete(false); }} title="Delete your account?">
        <View style={styles.sheetBody}>
          <T variant="serifMd" style={{ color: color.danger }}>Delete your account?</T>
          <T variant="body" style={{ color: color.textSecondary }}>
            This permanently deletes your Fandex account and everything attached to it. It cannot be undone.
          </T>
          {held.some(([, n]) => n > 0) ? (
            <View style={styles.footprint}>
              {held.filter(([, n]) => n > 0).map(([label, n]) => (
                <View key={label} style={styles.line}>
                  <T variant="body" style={{ color: color.textSecondary, flex: 1 }}>{label}</T>
                  <T variant="body">{n.toLocaleString('en')}</T>
                </View>
              ))}
            </View>
          ) : null}
          <T variant="bodySm">
            Your ratings and lists on Trakt and Steam are not affected. This clears only what Fandex stores. Your data is removed
            immediately; copies in the backups age out with the backup retention window.
          </T>
          <View>
            <T variant="bodySm" style={{ marginBottom: 4 }}>Type DELETE to confirm</T>
            <TextInput
              accessibilityLabel="Type DELETE to confirm"
              autoCapitalize="characters"
              autoCorrect={false}
              value={confirm}
              onChangeText={setConfirm}
              style={styles.input}
            />
          </View>
          <View style={styles.sheetActions}>
            <Button
              label={deleting ? 'Deleting...' : 'Delete my account'} variant="danger" size="md" style={{ flex: 1 }}
              disabled={confirm !== 'DELETE' || deleting} onPress={deleteAccount}
            />
            <Button label="Cancel" variant="outline" size="md" disabled={deleting} onPress={() => setShowDelete(false)} />
          </View>
        </View>
      </Sheet>
    </Section>
  );
}

// The site's Import section (SettingsPageClient.tsx). Before it, the import page
// existed and nothing linked to it: "i would have expected an import button in
// my user settings" (Nils, 2026-09-02).
function ImportRow() {
  const router = useRouter();
  return (
    <Section eyebrow="Import" hint="Bring ratings and watchlists across from another tracker.">
      <Card row>
        <RowText
          title="Import from Letterboxd or IMDb"
          text="Both let you download your own data for free. Choose the file and Fandex reads your ratings and watchlist from it."
        />
        <Button label="Import" onPress={() => router.push('/import' as never)} />
      </Card>
    </Section>
  );
}

// ── What the app has that the site did not ───────────────────────────────────

function WidgetOffer() {
  const [note, setNote] = useState<string | null>(null);
  if (!widgetAvailable) return null;
  return (
    <Section eyebrow="Home screen">
      <Card row>
        <RowText
          title="Up next widget"
          text="The next episode of each show you are watching, with a tick that marks it watched."
        />
        <Button
          label="Add"
          onPress={() => setNote(requestWidget()
            ? null
            : 'This home screen cannot add it for you. Long-press the home screen, open Widgets, and pick Fandex.')}
        />
      </Card>
      {note ? <T variant="bodySm" style={{ color: color.warning }}>{note}</T> : null}
    </Section>
  );
}

function Device() {
  const db = useSQLiteContext();
  const auth = useAuth();
  const sync = useCatalogSync();
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
    <Section eyebrow="This device" hint="The catalog is kept on the device, so lists and search work without a connection.">
      <Card>
        <Line label="Titles" value={sync.total.toLocaleString('en')} />
        {/* Every type, books and board games included, and only those the device holds. */}
        {MEDIA_TYPES.filter((t) => (counts[t] ?? 0) > 0 || t === 'game' || t === 'movie' || t === 'show').map((t) => (
          <Line key={t} label={TYPE_PLURAL[t] ?? t} value={(counts[t] ?? 0).toLocaleString('en')} />
        ))}
        <Line label="Status" value={status} tone={sync.state === 'error' ? color.danger : undefined} />
        {sync.error ? <T variant="bodySm">{sync.error}</T> : null}
        <Line label="Release dates for" value={auth.region} />
        <Line
          label="Catalog server"
          value={server === 'checking' ? 'Checking…' : server === 'up' ? 'Reachable' : 'Not reachable'}
          tone={server === 'down' ? color.danger : undefined}
        />
        {API_URL && API_URL !== '/' ? <T variant="meta" style={{ color: color.textMuted }}>{API_URL.replace(/^https?:\/\//, '')}</T> : null}
        <View style={styles.actions}>
          <Button label="Check for changes" onPress={sync.sync} />
          <Button label="Download again" onPress={sync.resync} />
        </View>
      </Card>
    </Section>
  );
}

/** The admin pages have no link anywhere else: on the site their addresses were typed. */
function AdminLinks() {
  const router = useRouter();
  return (
    <Section eyebrow="Admin" hint="Only your account sees this.">
      <Card>
        <View style={styles.actions}>
          <Button label="Scoring" onPress={() => router.push('/dev/scoring' as never)} />
          <Button label="Users" onPress={() => router.push('/dev/users' as never)} />
          <Button label="Traffic" onPress={() => router.push('/dev/analytics' as never)} />
        </View>
      </Card>
    </Section>
  );
}

// ── The screen ───────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  usePageTitle('Settings');
  const db = useSQLiteContext();
  const auth = useAuth();
  const catalog = useCatalogSync();
  const [notice, setNotice] = useState<Notice>(null);
  const [counts, setCounts] = useState({ library: 0, wishlist: 0, missing: 0 });
  useEffect(() => {
    let live = true;
    void shelfCounts(db).then((c) => { if (live) setCounts(c); }, (e: unknown) => {
      console.warn('shelf_counts_failed', e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    });
    // The count is of titles the catalog copy holds, so it also moves while that downloads.
    return () => { live = false; };
  }, [db, auth.rowsRevision, catalog.revision, catalog.state]);

  const identities = auth.profile?.identities ?? [];
  const who = identities.find((i) => i.displayName)?.displayName;
  const via = identities.map((i) => PROVIDER_NAME[i.provider] ?? i.provider).join(', ');

  return (
    <Screen wide>
      <ScrollView contentContainerStyle={styles.main}>
        <T variant="serifXl">Settings</T>

        {notice ? (
          <View style={[styles.notice, notice.ok ? styles.noticeOk : styles.noticeBad]}>
            <T variant="body" style={{ color: notice.ok ? color.success : color.danger }}>{notice.msg}</T>
          </View>
        ) : null}

        {auth.status === 'loading' ? (
          <ActivityIndicator color={color.accent} />
        ) : auth.status === 'signedOut' ? (
          <SignIn
            title="Sign in to open your settings"
            hint="Connections, region, your data export and account deletion all belong to an account. There is nothing here to change without one."
          />
        ) : (
          <>
            {/* Above the account list, as on the site: it is the one thing on the page waiting for an answer. */}
            <MergePanel onNotice={setNotice} />
            <Section eyebrow="Connected accounts" hint="How you sign in, and where your library comes from.">
              {identities.map((i) => <ProviderPanel key={i.provider} provider={i.provider} onNotice={setNotice} />)}
              {/* "Sign in again" on the Trakt row, in a browser: the code to confirm has to be shown somewhere. */}
              {identities.some((i) => i.provider === 'trakt') ? <TraktCodeCard /> : null}
              {/* Only once the profile has loaded: offline, "not connected" would be a guess. */}
              {auth.profile && !identities.some((i) => i.provider === 'trakt') ? <AddProvider provider="trakt" /> : null}
              {auth.profile && googleAvailable() && !identities.some((i) => i.provider === 'google') ? <AddProvider provider="google" /> : null}
              {auth.profile && discordAvailable() && !identities.some((i) => i.provider === 'discord') ? <AddProvider provider="discord" /> : null}
              {!auth.profile ? <T variant="bodySm">Offline. Showing what is on this device.</T> : null}
              {/* A local Worker only, as on the sign-in card: joining two accounts, tried without a real provider. */}
              {LOCAL_API && auth.profile && !identities.some((i) => i.provider === 'discord') ? (
                <Button
                  label="Connect the third test account"
                  variant="outline"
                  onPress={() => void auth.devConnect('third').catch((e: unknown) => setNotice({ ok: false, msg: e instanceof Error ? e.message : 'Did not connect.' }))}
                  style={{ alignSelf: 'flex-start' }}
                />
              ) : null}
            </Section>

            <ImportRow />
            <Region onNotice={setNotice} />
            <DefaultTypes onNotice={setNotice} />
            <YourPlatforms onNotice={setNotice} />

            <Section eyebrow="Account">
              <Card>
                <Line label="Logged in as" value={who ? `${who}${via ? ` via ${via}` : ''}` : via || 'Yes'} />
                <Line label="Library" value={count(counts.library, 'title')} />
                <Line label="Wishlist" value={count(counts.wishlist, 'title')} />
                {auth.rowsSyncing ? <T variant="bodySm">Refreshing your library…</T> : null}
                {auth.rowsError ? <T variant="bodySm" style={{ color: color.warning }}>{auth.rowsError}</T> : null}
                <View style={styles.actions}>
                  <Button label="Refresh library" onPress={auth.syncRows} disabled={auth.rowsSyncing} />
                  <Button label="Sign out" onPress={() => void auth.signOut()} />
                </View>
                <T variant="meta" style={{ color: color.textMuted }}>Signing out signs out every device on this account.</T>
              </Card>
            </Section>

            <YourData onNotice={setNotice} counts={counts} />
            {auth.profile?.admin ? <AdminLinks /> : null}
            <WidgetOffer />
          </>
        )}

        <Device />
        {Platform.OS === 'web' ? null : <LegalLinks />}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  main: { width: '100%', maxWidth: 672, alignSelf: 'center', paddingHorizontal: 24, paddingVertical: 40, gap: 32 },

  notice: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: space.md },
  noticeOk: { backgroundColor: color.successSubtle, borderColor: 'rgba(95,227,154,0.4)' },
  noticeBad: { backgroundColor: color.dangerSubtle, borderColor: 'rgba(229,103,76,0.4)' },

  section: { gap: space.md },
  sectionHead: { gap: 4 },
  hint: { color: color.textSecondary },
  card: {
    padding: space.xl, gap: space.sm, borderRadius: radius.lg,
    backgroundColor: color.surfaceElevated, borderWidth: 1, borderColor: color.border,
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.lg },
  cardDanger: { borderColor: 'rgba(229,103,76,0.4)' },
  cardWarning: { borderColor: 'rgba(240,160,75,0.4)', gap: space.md },
  sides: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  side: {
    flexGrow: 1, flexBasis: 220, minWidth: 0, padding: space.lg, gap: 4, borderRadius: radius.md,
    backgroundColor: color.surfaceInset, borderWidth: 1, borderColor: color.border,
  },
  sideWho: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minWidth: 0 },
  strong: { fontFamily: font.sansBold, color: color.textPrimary },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontFamily: font.sansBold },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.lg },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingTop: space.xs },

  provider: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: space.md, marginBottom: 4 },
  providerWho: { flexDirection: 'row', alignItems: 'center', gap: space.md, minWidth: 0, flexGrow: 1, flexShrink: 1 },
  providerActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  glyph: {
    width: 32, height: 32, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
    backgroundColor: color.surface, borderWidth: 1, borderColor: color.border,
  },
  connected: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.full,
    backgroundColor: color.successSubtle, borderWidth: 1, borderColor: 'rgba(95,227,154,0.4)',
  },

  select: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, maxWidth: 200,
    paddingHorizontal: space.md, minHeight: 38, borderRadius: radius.md,
    backgroundColor: color.surfaceInset, borderWidth: 1, borderColor: color.borderStrong,
  },
  countries: { maxHeight: 420 },
  country: { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingHorizontal: space.xl },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44, paddingHorizontal: space.lg,
    borderRadius: radius.full, borderWidth: 1, borderColor: color.borderStrong,
  },
  chipOn: { backgroundColor: color.accentSubtle, borderColor: color.accent },
  platformChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  platformChip: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44, paddingHorizontal: space.md,
    borderRadius: radius.full, borderWidth: 1, borderColor: color.borderStrong,
  },
  platformHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  textButton: { minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center', paddingHorizontal: space.sm },

  sheetBody: { padding: 24, gap: space.lg },
  sheetActions: { flexDirection: 'row', gap: space.sm, paddingTop: 4 },
  footprint: {
    paddingHorizontal: space.lg, paddingVertical: space.md, gap: 4, borderRadius: radius.md,
    backgroundColor: color.surfaceInset, borderWidth: 1, borderColor: color.border,
  },
  input: {
    minHeight: 38, paddingHorizontal: space.md, borderRadius: radius.md, fontFamily: font.sans, fontSize: 13,
    color: color.textPrimary, backgroundColor: color.surfaceInset, borderWidth: 1, borderColor: color.borderStrong,
  },
});
