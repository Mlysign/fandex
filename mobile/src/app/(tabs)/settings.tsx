// Settings. A port of the site's src/app/settings/SettingsPageClient.tsx and its
// pickers (src/components/settings/), section for section: connected accounts,
// region, default types, account, your data.
//
// Not carried yet: the Import row and joining two accounts. Kept from the app: the widget offer and what this device
// holds, which the site had no use for.
import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Check, ChevronDown, Clapperboard, Gamepad2, Tv } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { COUNTRIES } from '@/lib/countries';
import { MEDIA_TYPES, MEDIA_TYPE_LABELS, enabledMediaTypes } from '@/lib/mediaTypes';
import { platformMarkName, type PlatformOption } from '@/lib/platformKeys';
import { BrandGlyph } from '~/components/BrandGlyph';
import { Button, Sheet } from '~/components/kit';
import { LegalLinks } from '~/components/LegalLinks';
import { SignIn } from '~/components/SignIn';
import { Screen, T } from '~/components/ui';
import { api, ApiError } from '~/lib/api';
import { useAuth } from '~/lib/AuthProvider';
import { useCatalogSync } from '~/lib/CatalogSyncProvider';
import { API_URL } from '~/lib/config';
import { catalogCounts, shelfCounts } from '~/lib/db';
import { shelfItemIds, usePlatformIndex } from '~/lib/platforms';
import type { TraktSyncResult } from '~/lib/traktSync';
import { useTypeFilter } from '~/lib/typeFilter';
import { requestWidget, widgetAvailable } from '~/lib/widget';
import { color, font, radius, space } from '~/theme';

type Notice = { msg: string; ok: boolean } | null;

const PROVIDER_NAME: Record<string, string> = { trakt: 'Trakt', google: 'Google', steam: 'Steam' };
const TYPE_ICON = { game: Gamepad2, movie: Clapperboard, show: Tv } as const;

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
    r.deferred ? `${r.deferred.toLocaleString('en')} new titles waiting for the next sync` : null,
  ].filter(Boolean);
  const what = parts.length ? parts.join(', ') : 'Nothing had changed';
  return r.dryRun ? `Test run, nothing written. Would be: ${what.toLowerCase()}.` : `${what}.`;
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
  trakt: { label: 'Trakt.tv', description: 'Movies & TV shows watchlist' },
  steam: { label: 'Steam', description: 'Games from your wishlist', readOnly: true },
};

function ProviderPanel({ provider, onNotice }: { provider: string; onNotice: (n: Notice) => void }) {
  const auth = useAuth();
  const { traktSync } = auth;
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
          {provider !== 'trakt' ? null : traktSync.needsSignIn
            ? <Button label="Sign in again" onPress={auth.startTraktSignIn} />
            : <Button label={traktSync.running ? 'Syncing...' : 'Sync'} onPress={auth.syncTraktNow} disabled={traktSync.running} />}
          <Button label={disconnecting ? '...' : 'Disconnect'} variant="danger" onPress={() => setAsking(true)} disabled={disconnecting} />
        </View>
      </View>
      {provider === 'trakt' ? (
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
      {meta.readOnly ? (
        <T variant="bodySm">
          Read-only. {meta.label} doesn’t support adding to a wishlist via its API. It does not sync in this version yet:
          what it brought in before is still in your library.
        </T>
      ) : null}
      {meta.identityOnly ? (
        <T variant="bodySm">Used to sign you in. It holds no library.</T>
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

/**
 * Google's mark, in its four colours. The one exception to "no brand colour":
 * Google's guidelines forbid a monochrome G (src/components/auth/GoogleMark.tsx).
 */
function GoogleMark({ size = 18 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <Path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <Path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <Path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </Svg>
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

  const allOn = selected.length === MEDIA_TYPES.length;
  return (
    <Section
      eyebrow="Default types"
      hint="Which types every list starts with. You can still switch one on from the filter row any time."
    >
      <Card>
        <View style={styles.chips}>
          {MEDIA_TYPES.map((t) => {
            const Icon = TYPE_ICON[t];
            const on = selected.includes(t);
            return (
              <Pressable
                key={t}
                onPress={() => toggle(t)}
                disabled={saving}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
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
            : `Off by default: ${MEDIA_TYPES.filter((t) => !selected.includes(t)).map((t) => MEDIA_TYPE_LABELS[t]).join(', ')}. Nothing is deleted or hidden for good. Tap the type in any list's filter row to bring it back for that visit.`}
          {saving ? ' Saving…' : ''}
        </T>
      </Card>
    </Section>
  );
}

// ── Your platforms ───────────────────────────────────────────────────────────

/** How many chips a group shows before "Show all". The site measured two rows; this is about two on a phone. */
const PLATFORM_FOLD = 8;

function PlatformGroup({ label, items, selected, onToggle, collapsible }: {
  label: string; items: PlatformOption[]; selected: string[]; onToggle: (key: string) => void; collapsible: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  // Selected first, in the order they had when the group was last opened or
  // closed: a chip must not jump away under the finger that just tapped it.
  const orderKey = `${items.map((o) => o.key).join('|')}|${expanded}`;
  const order = useMemo(() => {
    const picked = new Set(selected);
    return [...items.filter((o) => picked.has(o.key)), ...items.filter((o) => !picked.has(o.key))];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderKey]);
  if (items.length === 0) return null;
  const collapsed = collapsible && !expanded;
  const shown = collapsed ? order.slice(0, PLATFORM_FOLD) : order;
  return (
    <View style={{ gap: space.sm }}>
      <T variant="meta">{label}</T>
      <View style={styles.platformChips}>
        {shown.map((o) => {
          const on = selected.includes(o.key);
          return (
            <Pressable
              key={o.key} onPress={() => onToggle(o.key)} accessibilityRole="button" accessibilityState={{ selected: on }}
              style={[styles.platformChip, on && styles.chipOn]}
            >
              <BrandGlyph source={platformMarkName(o.label)} size={16} tint={on ? color.textPrimary : color.textSecondary} />
              <T variant="label" style={{ color: on ? color.textPrimary : color.textSecondary }} numberOfLines={1}>{o.label}</T>
              <T variant="meta" style={{ color: color.textMuted }}>{o.count}</T>
            </Pressable>
          );
        })}
      </View>
      {collapsible && items.length > PLATFORM_FOLD ? (
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
                {selected.length === 0 ? `Nothing selected. The filter offers all ${options.length}.` : `${selected.length} of ${options.length} selected.`}
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
  const [exporting, setExporting] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);

  const exportData = () => {
    setExporting(true);
    api.exportAccount()
      .then((data) => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `fandex-export-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        onNotice({ msg: 'Your data export has been downloaded.', ok: true });
      })
      .catch((e: unknown) => onNotice({ msg: failure(e, 'Could not prepare your export. Please try again.'), ok: false }))
      .finally(() => setExporting(false));
  };

  const deleteAccount = () => {
    setDeleting(true);
    auth.deleteAccount()
      .then(() => router.replace('/' as never))
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
          text={Platform.OS === 'web'
            ? 'Everything Fandex stores about you, as a JSON file: library, wishlist, ratings and connected accounts.'
            : 'Everything Fandex stores about you, as a JSON file. The download is on fandex.org, in Settings.'}
        />
        {Platform.OS === 'web'
          ? <Button label={exporting ? 'Preparing...' : 'Download'} onPress={exportData} disabled={exporting} />
          : null}
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
        <Line label="Games" value={(counts.game ?? 0).toLocaleString('en')} />
        <Line label="Movies" value={(counts.movie ?? 0).toLocaleString('en')} />
        <Line label="Shows" value={(counts.show ?? 0).toLocaleString('en')} />
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

// ── The screen ───────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const db = useSQLiteContext();
  const auth = useAuth();
  const catalog = useCatalogSync();
  const [notice, setNotice] = useState<Notice>(null);
  const [counts, setCounts] = useState({ library: 0, wishlist: 0, missing: 0 });
  useEffect(() => {
    void shelfCounts(db).then(setCounts);
    // The count is of titles the catalog copy holds, so it also moves while that downloads.
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
            <Section eyebrow="Connected accounts" hint="Any connected account can be used to log in.">
              {identities.map((i) => <ProviderPanel key={i.provider} provider={i.provider} onNotice={setNotice} />)}
              {!auth.profile ? <T variant="bodySm">Offline. Showing what is on this device.</T> : null}
            </Section>

            <Region onNotice={setNotice} />
            <DefaultTypes onNotice={setNotice} />
            <YourPlatforms onNotice={setNotice} />

            <Section eyebrow="Account">
              <Card>
                <Line label="Logged in as" value={who ? `${who}${via ? ` via ${via}` : ''}` : via || 'Yes'} />
                <Line label="Library" value={`${counts.library.toLocaleString('en')} titles`} />
                <Line label="Wishlist" value={`${counts.wishlist.toLocaleString('en')} titles`} />
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
