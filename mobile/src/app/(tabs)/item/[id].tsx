// One title on the device: the shared page (components/ItemPage) with what is
// yours slotted in: your state, your Fandex Score, the rating row.

import { useLocalSearchParams, useRouter } from 'expo-router';
import { Bookmark, Star } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, Share, StyleSheet, View } from 'react-native';
import { StarPicker } from '~/components/cards';
import { ItemPage } from '~/components/ItemPage';
import { Button } from '~/components/kit';
import { LegalLinks, SITE_URL } from '~/components/LegalLinks';
import { FandexBadge, Screen, StateBlock, T } from '~/components/ui';
import { useSQLiteContext } from 'expo-sqlite';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, ApiError, type ItemDetail } from '~/lib/api';
import { useAuth } from '~/lib/AuthProvider';
import { itemStateFor } from '~/lib/db';
import type { ScoreReason } from '~/lib/fandexScore';
import { rateItem, removeFromLibrary, setWishlist, type ActionTarget } from '~/lib/itemActions';
import { dropItemPrerender } from '~/lib/prerender';
import { useScores } from '~/lib/ScoreProvider';
import { deviceRegion } from '~/lib/region';
import { TraktAuthError } from '~/lib/trakt';
import { color, radius, space } from '~/theme';

const RATINGS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const ROLE_LABEL: Record<string, string> = {
  director: 'Director', creator: 'Creator', writer: 'Writer', cast: 'Cast',
  developer: 'Developer', publisher: 'Publisher', studio: 'Studio', network: 'Network', ip: 'Franchise',
};

/** What kind of thing a reason is, in a word: its role for a person or company, its category for a tag. */
function reasonKind(r: ScoreReason, categoryLabel: (id: string | undefined) => string | null): string {
  if (r.kind === 'tag') return categoryLabel(r.category) ?? 'Tag';
  return ROLE_LABEL[r.role ?? ''] ?? (r.kind === 'ip' ? 'Franchise' : r.kind === 'person' ? 'Person' : 'Company');
}

const PUBLIC_TYPES = new Set(['movie', 'show', 'game']);

export default function ItemScreen() {
  // Two addresses lead here. `/item/{id}` is the app's own. `/{type}/{slug}` is
  // the public one, the address the website's static pages live at and the one
  // Share hands out (src/app/[type]/[slug].tsx re-exports this screen). The
  // Worker answers both under /v1/items/.
  const params = useLocalSearchParams<{ id?: string; type?: string; slug?: string }>();
  const known = params.id != null || PUBLIC_TYPES.has(params.type ?? '');
  const address = params.id ?? `${params.type}/${params.slug}`;
  const region = useMemo(deviceRegion, []);
  const router = useRouter();
  // The hero runs under the status bar and the page under Android's navigation
  // buttons, so the hero's buttons and the last line each have to clear one.
  const { top } = useSafeAreaInsets();
  const [item, setItem] = useState<ItemDetail | null>(null);
  const [error, setError] = useState<{ title: string; detail: string } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    // This screen stays mounted between titles, so the last one must not show under the next one's address.
    setItem(null);
    // An address that is not a title's shape (a mistyped link, a probe) is
    // answered here, without asking the Worker.
    if (!known) {
      setError({ title: 'Nothing here', detail: 'Fandex has no page at this address.' });
      return;
    }
    try {
      setItem(await api.item(address, region));
    } catch (e) {
      const code = e instanceof ApiError ? e.code : '';
      setError(
        code === 'offline'
          ? { title: 'No connection', detail: 'This page needs a connection to load.' }
          : code === 'not-found'
            ? { title: 'Not in the catalog', detail: 'Fandex does not hold a title at this address.' }
            : { title: 'Could not load this title', detail: 'Something went wrong.' },
      );
    }
  }, [address, known, region]);

  useEffect(() => {
    void load();
  }, [load]);

  // On the website this screen may have started under a static copy of the
  // same page. Once the item is on screen the copy goes (lib/prerender.ts).
  // An effect runs after the page is in the document, so the next frame the
  // browser paints already has it. Not requestAnimationFrame: that never fires
  // in a tab nobody is looking at, and the copy would sit there until they did.
  const loaded = item != null;
  useEffect(() => {
    if (loaded) dropItemPrerender();
  }, [loaded]);

  // What this device knows about you and this title. Keyed by the item's own
  // id, which the public address does not carry.
  const itemId = item?.id ?? null;
  const db = useSQLiteContext();
  const auth = useAuth();
  const [mine, setMine] = useState<Awaited<ReturnType<typeof itemStateFor>> | null>(null);
  useEffect(() => {
    let live = true;
    if (auth.status !== 'signedIn' || !itemId) {
      setMine(null);
      return;
    }
    void itemStateFor(db, itemId).then((s) => { if (live) setMine(s); });
    return () => { live = false; };
  }, [db, itemId, auth.status, auth.rowsRevision]);

  const scores = useScores();
  const [whyOpen, setWhyOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  /** Run one action; say why if it failed. A failed step wrote nothing after it. */
  const act = useCallback((run: () => Promise<void>) => {
    setBusy(true);
    setActionError(null);
    run()
      .then(() => auth.rowsChanged())
      .catch((e: unknown) => {
        console.warn('item_action_failed', e instanceof Error ? `${e.name}: ${e.message}` : String(e));
        setActionError(
          e instanceof TraktAuthError ? 'Trakt needs you to sign in again. You can do that on the You tab.'
          : e instanceof ApiError && e.code === 'offline' ? 'No connection. Nothing was changed.'
          : e instanceof ApiError && e.code === 'budget-exhausted' ? 'Fandex cannot save more changes until tomorrow.'
          : e instanceof ApiError ? 'Fandex could not save that. Nothing was changed.'
          : e instanceof Error ? e.message : 'That did not work. Nothing was changed.',
        );
      })
      .finally(() => setBusy(false));
  }, [auth]);

  if (error) {
    return (
      <Screen headed>
        <StateBlock title={error.title} detail={error.detail} action={{ label: 'Try again', onPress: () => void load() }} />
      </Screen>
    );
  }
  if (!item) {
    return (
      <Screen headed>
        <StateBlock loading />
      </Screen>
    );
  }

  // Scored from the facets the Worker sent with the page, so a title that is
  // not in the device's catalog copy (one just opened from search) scores too.
  const fandex = scores.score(item.id, item.facets);
  const counted = fandex ? fandex.reasons.filter((r) => !r.capped) : [];
  const uncounted = fandex ? fandex.reasons.length - counted.length : 0;
  const target: ActionTarget = { id: item.id, type: item.type, sources: item.vector.sources };

  const personal = (
    <>
      {mine && (mine.inLibrary || mine.inWishlist) ? (
        <View style={styles.mine}>
          <T variant="label" style={{ color: color.accent }}>
            {[
              mine.inLibrary ? (mine.status ? `In your library · ${mine.status}` : 'In your library') : null,
              mine.inWishlist ? 'On your wishlist' : null,
            ].filter(Boolean).join(' · ')}
          </T>
          {mine.rating != null ? <T variant="label">You rated it {mine.rating}</T> : null}
        </View>
      ) : null}

      {fandex ? (
        <View style={styles.fandex}>
          <View style={styles.fandexHead}>
            <FandexBadge score={fandex.score} center={fandex.center} large />
            <View style={{ flex: 1, minWidth: 0 }}>
              <T variant="title">Fandex Score</T>
              <T variant="caption">
                How well this matches your taste. A title you have no opinion about scores {Math.round(fandex.center)}, your own average.
              </T>
            </View>
          </View>
          {counted.slice(0, whyOpen ? counted.length : 4).map((r) => (
            <View key={`${r.kind}|${r.role ?? ''}|${r.label}`} style={styles.reason}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <T variant="body" numberOfLines={1}>{r.label}</T>
                <T variant="meta" numberOfLines={1}>
                  {reasonKind(r, scores.categoryLabel)} · you rate these {r.BA.toFixed(1)} over {r.n} {r.n === 1 ? 'title' : 'titles'}
                </T>
              </View>
              <T variant="title" style={{ color: r.contribution >= 0 ? color.success : color.danger }}>
                {r.contribution >= 0 ? '+' : '−'}{Math.abs(r.contribution).toFixed(1)}
              </T>
            </View>
          ))}
          {counted.length > 4 || uncounted > 0 ? (
            <Pressable onPress={() => setWhyOpen((v) => !v)} accessibilityRole="button" style={styles.whyToggle}>
              <T variant="label" style={{ color: color.accent }}>
                {whyOpen ? 'Show less' : `Show all ${counted.length} that count`}
              </T>
              {whyOpen && uncounted > 0 ? (
                <T variant="meta">{uncounted} more matched and were left out: only the strongest few count.</T>
              ) : null}
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {auth.status === 'signedIn' && mine ? (
        <View style={styles.actionsBlock}>
          <T variant="eyebrow">Your rating</T>
          {/* The site's ten stars. The one that is already your rating takes it away. */}
          <View style={[styles.starsPanel, busy && { opacity: 0.6 }]} pointerEvents={busy ? 'none' : 'auto'}>
            <StarPicker rating={mine.rating} onPick={(n) => act(() => rateItem(db, target, n))} />
            <T variant="meta">{mine.rating != null ? `${mine.rating}/10` : 'Not rated'}</T>
          </View>
          <View style={styles.actionRow}>
            <Button
              label={mine.inWishlist ? 'On your wishlist' : 'Add to wishlist'} variant={mine.inWishlist ? 'outline' : 'secondary'} size="md" disabled={busy}
              icon={<Bookmark size={14} color={mine.inWishlist ? color.accent : color.textPrimary} fill={mine.inWishlist ? color.accent : 'none'} />}
              onPress={() => act(() => setWishlist(db, target, !mine.inWishlist))}
            />
            {mine.inLibrary ? (
              <Button label="Remove from library" variant="outline" size="md" disabled={busy} onPress={() => act(() => removeFromLibrary(db, target))} />
            ) : null}
          </View>
          {actionError ? <T variant="caption" style={{ color: color.warning }}>{actionError}</T> : null}
        </View>
      ) : auth.status === 'signedOut' ? (
        // Shown to everybody, as on the site: a control that is missing reads as a feature that is missing.
        <View style={styles.actionRow}>
          <Button label="Rate" variant="secondary" size="md" icon={<Star size={14} color={color.textPrimary} />} onPress={() => router.push('/profile' as never)} />
          <Button label="Add to wishlist" variant="secondary" size="md" icon={<Bookmark size={14} color={color.textPrimary} />} onPress={() => router.push('/profile' as never)} />
        </View>
      ) : null}
    </>
  );

  // The address somebody else can open: the website's page for this title.
  const share = () => {
    const url = `${SITE_URL}/${item.type}/${item.slug ?? item.id}`;
    void Share.share(Platform.OS === 'ios' ? { url, title: item.merged.title } : { message: url, title: item.merged.title }).catch(() => {});
  };

  return (
    <Screen headed>
      <ItemPage
        item={item}
        personal={personal}
        // The static page ends with the legal links, so in a browser this one does too.
        footer={Platform.OS === 'web' ? <LegalLinks /> : undefined}
        taxonomy={scores.taxonomy}
        topInset={top}
        // The navigation bar is below this screen and clears the phone's own buttons itself.
        bottomInset={0}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        onShare={share}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  // The page sets the gutter and the gap between blocks; these only shape themselves.
  mine: {
    flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: space.sm,
    padding: space.md, borderRadius: radius.md, backgroundColor: color.accentSubtle,
  },
  fandex: {
    padding: space.md, gap: space.sm,
    borderRadius: radius.lg, backgroundColor: color.surfaceElevated, borderWidth: 1, borderColor: color.border,
  },
  fandexHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  reason: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  whyToggle: { minHeight: 44, justifyContent: 'center', gap: space.xxs },
  actionsBlock: { gap: space.sm },
  // Ten across a 360 px screen: flex shares the row, the height is the tap target.
  stars: { flexDirection: 'row', gap: space.xs },
  star: {
    flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.sm, borderWidth: 1, borderColor: color.borderStrong,
  },
  starOn: { backgroundColor: color.accent, borderColor: color.accent },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  starsPanel: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, paddingRight: space.md,
    borderRadius: radius.lg, backgroundColor: color.surfaceElevated, borderWidth: 1, borderColor: color.border,
  },
  action: {
    paddingHorizontal: space.md, minHeight: 44, justifyContent: 'center',
    borderRadius: radius.md, borderWidth: 1, borderColor: color.borderStrong,
  },
  actionOn: { borderColor: color.accent },
});
