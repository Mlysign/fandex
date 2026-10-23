// One title on the device: the shared page (components/ItemPage) with what is
// yours slotted in: your state, your Fandex Score, the rating row.

import { useLocalSearchParams, useRouter } from 'expo-router';
import { Bookmark, Eye, EyeOff, Star } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { CardRail, StarPicker } from '~/components/cards';
import { EpisodeTracker } from '~/components/EpisodeTracker';
import { FandexScorePanel, type ScorePanelState } from '~/components/FandexScorePanel';
import { ItemPage, SOURCE_LABEL } from '~/components/ItemPage';
import { BrandGlyph } from '~/components/BrandGlyph';
import { Button } from '~/components/kit';
import { useToast } from '~/components/Toast';
import { LegalLinks, SITE_URL } from '~/components/LegalLinks';
import { Screen, StateBlock, T } from '~/components/ui';
import { useSQLiteContext } from 'expo-sqlite';
import { keyToSlug } from '@/lib/facetUrl';
import { normalizeName } from '@/lib/normalize';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { toggled } from '~/lib/a11y';
import { api, ApiError, type ItemDetail } from '~/lib/api';
import { useAuth } from '~/lib/AuthProvider';
import type { CardItem } from '~/lib/cards';
import { useCatalogSync } from '~/lib/CatalogSyncProvider';
import { itemStateFor } from '~/lib/db';
import { shortDate } from '~/lib/dates';
import { setReturnTo } from '~/lib/returnTo';
import type { ScoreFacet } from '~/lib/fandexScore';
import { rateItem, removeFromLibrary, setHidden, setWishlist, type ActionTarget } from '~/lib/itemActions';
import { usePageTitle } from '~/lib/pageTitle';
import { dropItemPrerender } from '~/lib/prerender';
import { relatedRails, type RelatedRails } from '~/lib/related';
import { useScores } from '~/lib/ScoreProvider';
import { tmdbCollectionFor } from '~/lib/tmdb';
import { TraktAuthError, traktSignInMessage } from '~/lib/trakt';
import { color, font, radius, space } from '~/theme';

const PUBLIC_TYPES = new Set(['movie', 'show', 'game', 'book', 'boardgame']);

/**
 * "More from {franchise}" and "More like this", picked on the device from its
 * catalog copy (lib/related.ts). Nothing until they are ready, and nothing at
 * all for a title with no franchise and too few titles like it: an empty shelf
 * reads as a broken one.
 */
function Related({ itemId, facets, tmdbMovieId, igdbId, bookSeries }: {
  itemId: string; facets: ScoreFacet[]; tmdbMovieId: string | null; igdbId: string | null;
  /** A book's series name: its other books come from Open Library. */
  bookSeries?: string | null;
}) {
  const db = useSQLiteContext();
  const catalog = useCatalogSync();
  const { taxonomy } = useScores();
  const [rails, setRails] = useState<RelatedRails | null>(null);

  // The rails go blank only for another title. Re-picked for the same one (the
  // catalog copy changed: rating a card in a rail brings that title in), the old
  // rails stay until the new ones are ready. Blanking them shrank the page under
  // a reader near its foot, and the browser threw them up it (2026-10-18).
  const railsFor = useRef<string | null>(null);
  /** The title whose rails are on screen now, held-only or complete. */
  const shownFor = useRef<string | null>(null);
  useEffect(() => {
    let live = true;
    const fresh = railsFor.current !== itemId;
    if (fresh) {
      railsFor.current = itemId;
      setRails(null);
    }
    if (!taxonomy) return;
    relatedRails(db, catalog.revision, taxonomy, itemId, facets)
      .then(async (r) => {
        // A new title shows what the device holds at once. The same title re-picked
        // keeps its old rails until the provider extras are back too: setting the
        // held-only rails first dropped "More from" for a moment on every rating,
        // and the page jumped (2026-10-23 review).
        if (live && shownFor.current !== itemId) { shownFor.current = itemId; setRails(r); }
        // The titles of its franchise the catalog does not hold, after the ones
        // it does: the site's franchise_members, which D1 does not have. A film's
        // TMDB collection; a game's IGDB franchise or collection, by its name.
        const ident = (c: { title: string; releaseDate: string | null }) => `${normalizeName(c.title)}|${c.releaseDate?.slice(0, 4) ?? ''}`;
        const have = new Set((r.franchise?.items ?? []).map(ident));
        let label = r.franchise?.label ?? null;
        let parts: CardItem[] = [];
        if (tmdbMovieId) {
          const collection = await tmdbCollectionFor(tmdbMovieId);
          label ??= collection?.name ?? null;
          parts = (collection?.parts ?? []).map((p) => ({
            key: `tmdb:movie:${p.sourceId}`, id: null, source: 'tmdb', sourceId: p.sourceId, type: 'movie', title: p.title,
            releaseDate: p.releaseDate, posterUrl: p.posterUrl, communityScore: null, communityVotes: p.votes,
          }));
        } else if (bookSeries) {
          label ??= bookSeries;
          const books = await api.facetBooks('franchise', bookSeries).then((b) => b.results, () => []);
          parts = books.map((b) => ({
            // The card's own source: a series member only Hardcover lists opens by its Hardcover id.
            key: `${b.source}:book:${b.sourceId}`, id: null, source: b.source, sourceId: b.sourceId, type: 'book', title: b.title,
            releaseDate: b.releaseDate, posterUrl: b.posterUrl, communityScore: b.rating, communityVotes: b.votes,
          }));
        } else if (igdbId) {
          const ip = label ?? facets.find((f) => f.kind === 'ip')?.label ?? null;
          label ??= ip;
          const games = ip ? await api.facetGames('franchise', ip).then((g) => g.results, () => []) : [];
          parts = games.filter((g) => g.sourceId !== igdbId).map((g) => ({
            key: `igdb:game:${g.sourceId}`, id: null, source: 'igdb', sourceId: g.sourceId, type: 'game', title: g.title,
            releaseDate: g.releaseDate, posterUrl: g.posterUrl, communityScore: g.rating, communityVotes: g.votes,
          }));
        }
        if (!live) return;
        const extra = label ? parts.filter((p) => !have.has(ident(p))) : [];
        if (!label || !extra.length) { setRails(r); return; }
        try {
          const res = await api.lookup(extra.map((c) => ({ source: c.source as string, type: c.type, id: c.sourceId as string })));
          const held = new Map(res.found.map((f) => [f.id, f]));
          for (const c of extra) {
            const f = held.get(c.sourceId as string);
            c.id = f?.mediaItemId ?? null;
            c.slug = f?.slug ?? null;
          }
        } catch { /* they open through /open all the same */ }
        if (!live) return;
        // The page's own title is never in its franchise rail, held or not.
        const items = [...(r.franchise?.items ?? []), ...extra.filter((c) => c.id !== itemId)]
          .sort((a, b) => ((b.releaseDate ?? '') < (a.releaseDate ?? '') ? -1 : 1)); // newest first, as the rail is
        setRails({ ...r, franchise: { key: r.franchise?.key ?? null, label, items } });
      })
      .catch((e: unknown) => console.warn('related_failed', e instanceof Error ? `${e.name}: ${e.message}` : String(e)));
    return () => { live = false; };
  }, [db, catalog.revision, taxonomy, itemId, facets, tmdbMovieId, igdbId, bookSeries]);

  if (!rails || (!rails.series?.items.length && !rails.franchise?.items.length && !rails.similar.length)) return null;
  return (
    <View style={{ gap: 40 }}>
      {/* The provider's own series of this medium, in order, before the whole franchise (lib/related.ts, seriesForItem). */}
      {rails.series?.items.length ? <CardRail title={rails.series.label} items={rails.series.items} /> : null}
      {/* See all opens the franchise's page, split into its series (Nils, 2026-10-18). */}
      {rails.franchise?.items.length ? (
        <CardRail
          title={`More from ${rails.franchise.label}`} items={rails.franchise.items}
          seeAllHref={rails.franchise.key ? `/franchise/${keyToSlug(rails.franchise.key)}` : undefined}
        />
      ) : null}
      {rails.similar.length ? <CardRail title="More like this" items={rails.similar} /> : null}
    </View>
  );
}

export default function ItemScreen() {
  // Two addresses lead here. `/item/{id}` is the app's own. `/{type}/{slug}` is
  // the public one, the address the website's static pages live at and the one
  // Share hands out (src/app/[type]/[slug].tsx re-exports this screen). The
  // Worker answers both under /v1/items/.
  const params = useLocalSearchParams<{ id?: string; type?: string; slug?: string }>();
  const known = params.id != null || PUBLIC_TYPES.has(params.type ?? '');
  const address = params.id ?? `${params.type}/${params.slug}`;
  const auth = useAuth();
  const region = auth.region;
  const router = useRouter();
  // The hero runs under the status bar and the page under Android's navigation
  // buttons, so the hero's buttons and the last line each have to clear one.
  const { top } = useSafeAreaInsets();
  const [item, setItem] = useState<ItemDetail | null>(null);
  const [error, setError] = useState<{ title: string; detail: string; gone?: boolean } | null>(null);

  /** Each load's number. A slower answer for an earlier title (or region) is dropped, not shown under this address. */
  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const mine = ++loadSeq.current;
    setError(null);
    // This screen stays mounted between titles, so the last one must not show under the next one's address.
    setItem(null);
    // An address that is not a title's shape (a mistyped link, a probe) is
    // answered here, without asking the Worker.
    if (!known) {
      setError({ title: 'Nothing here', detail: 'Fandex has no page at this address.', gone: true });
      return;
    }
    try {
      const got = await api.item(address, region);
      if (mine === loadSeq.current) setItem(got);
    } catch (e) {
      if (mine !== loadSeq.current) return;
      const code = e instanceof ApiError ? e.code : '';
      setError(
        code === 'offline'
          ? { title: 'No connection', detail: 'This page needs a connection to load.' }
          : code === 'not-found'
            ? { title: 'Not in the catalog', detail: 'Fandex does not hold a title at this address.', gone: true }
            // The Worker refuses an id that is not an id at all (`/item/not-a-uuid`).
            // Asking again cannot change that, so no Try again (SM82).
            : code === 'bad-request'
            ? { title: 'Nothing here', detail: 'Fandex has no page at this address.', gone: true }
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
  // The static page's own title: the name and the year. The site's title while it loads.
  usePageTitle(item ? `${item.merged.title}${item.merged.releaseDate ? ` (${item.merged.releaseDate.slice(0, 4)})` : ''}` : null);
  const loaded = item != null;
  useEffect(() => {
    if (loaded) dropItemPrerender();
  }, [loaded]);

  // What this device knows about you and this title. Keyed by the item's own
  // id, which the public address does not carry.
  const itemId = item?.id ?? null;
  const db = useSQLiteContext();
  const [mine, setMine] = useState<Awaited<ReturnType<typeof itemStateFor>> | null>(null);
  const [hidden, setHiddenHere] = useState(false);
  useEffect(() => {
    let live = true;
    if (auth.status !== 'signedIn' || !itemId) {
      setMine(null);
      setHiddenHere(false);
      return;
    }
    void itemStateFor(db, itemId).then((s) => { if (live) setMine(s); });
    void db.getFirstAsync<{ n: number }>('SELECT COUNT(*) n FROM hidden_item WHERE media_item_id = ?', [itemId])
      .then((row) => { if (live) setHiddenHere((row?.n ?? 0) > 0); });
    return () => { live = false; };
  }, [db, itemId, auth.status, auth.rowsRevision]);

  const scores = useScores();
  const catalog = useCatalogSync();
  const [busy, setBusy] = useState(false);
  /** Remove from library pressed, and its Undo still on screen: nothing is removed until the toast ends. */
  const [removing, setRemoving] = useState(false);
  const { toast } = useToast();
  const [picking, setPicking] = useState(false);
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
          e instanceof TraktAuthError ? traktSignInMessage(e, 'You can do that on the You tab.')
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
        {/* Trying again cannot bring back a title that is not there. Search can find the one that was meant. */}
        <StateBlock
          title={error.title} detail={error.detail}
          action={error.gone ? { label: 'Search the catalog', onPress: () => router.replace('/discover' as never) } : { label: 'Try again', onPress: () => void load() }}
        />
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
  // Which of its four faces the score panel shows. Null while the session or
  // the taste profile is still being read: the panel's box is held open so the
  // synopsis under it does not jump when the answer arrives.
  //
  // ⚠️ No number while your rows or the catalog copy are still arriving: the
  // panel says it is reading your library instead. The
  // profile is rebuilt as they land, so a score read in the middle is made from
  // part of your library: on the live site a second tab, which downloads both
  // again, showed 79, then 85, then 83 for one film (2026-10-11).
  const settling = auth.rowsSyncing || catalog.state === 'syncing';
  const panel: ScorePanelState | null =
    auth.status === 'signedOut' ? 'anon'
    : auth.status !== 'signedIn' || !scores.ready ? null
    : settling ? 'settling'
    : fandex ? 'scored'
    : scores.center == null ? 'cold' : 'none';
  const target: ActionTarget = { id: item.id, type: item.type, sources: item.vector.sources };

  // A signed-out Rate or Save goes to You to sign in, and comes back here after (lib/returnTo.ts).
  const signInFirst = () => {
    setReturnTo(`/${item.type}/${item.slug ?? item.id}`);
    router.push('/profile' as never);
  };

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
          {/* The site's RatingsSection: the status names the accounts that report it, and when. */}
          {mine.status ? (
            <T variant="label">
              ✓ {mine.status}
              {mine.statusSources.length ? ` on ${mine.statusSources.map((s) => SOURCE_LABEL[s] ?? s).join(' · ')}` : ''}
              {mine.reviewedAt ? ` · ${shortDate(mine.reviewedAt)}` : ''}
            </T>
          ) : null}
        </View>
      ) : null}

      {panel ? (
        <FandexScorePanel
          state={panel} fandex={fandex} categoryLabel={scores.categoryLabel}
          onSignIn={() => router.push('/profile' as never)} onOpenFacet={(href) => router.push(href as never)}
        />
      ) : <View style={styles.panelHold} />}

      {auth.status === 'signedIn' && mine ? (
        <View style={styles.actionsBlock}>
          {/* The site's pair (PersonalSection.tsx): Rate it, which opens the ten stars, and Save.
              The rating shows on the button itself, once. */}
          <View style={styles.pair}>
            <Button
              label={mine.rating != null ? `${mine.rating}/10` : 'Rate it'} variant={mine.rating != null ? 'outline' : 'secondary'} size="md" disabled={busy}
              icon={<Star size={14} color={mine.rating != null ? color.accent : color.textPrimary} fill={mine.rating != null ? color.accent : 'none'} />}
              onPress={() => setPicking((v) => !v)} style={{ flex: 1 }}
            />
            <Button
              label="Save" variant={mine.inWishlist ? 'outline' : 'secondary'} size="md" disabled={busy}
              icon={<Bookmark size={14} color={mine.inWishlist ? color.accent : color.textPrimary} fill={mine.inWishlist ? color.accent : 'none'} />}
              onPress={() => act(() => setWishlist(db, target, !mine.inWishlist))}
            />
          </View>
          {picking ? (
            // The star that is already your rating takes it away.
            <View style={[styles.starsPanel, busy && { opacity: 0.6 }]} pointerEvents={busy ? 'none' : 'auto'}>
              <StarPicker rating={mine.rating} onPick={(n) => { setPicking(false); act(() => rateItem(db, target, n)); }} />
            </View>
          ) : null}
          {mine.review ? <T variant="bodySm" style={{ fontStyle: 'italic' }}>&quot;{mine.review}&quot;</T> : null}
          {/* Each account's own number, when more than one holds a rating: the one above is their average. */}
          {mine.ratings.length > 1 ? (
            <View style={styles.breakdown}>
              {mine.ratings.map((r) => (
                <View key={r.source} style={styles.breakdownItem}>
                  <BrandGlyph source={r.source} size={11} />
                  <T variant="caption">{SOURCE_LABEL[r.source] ?? r.source}</T>
                  <T variant="caption" style={{ color: color.textPrimary }}>{r.rating % 1 === 0 ? r.rating : r.rating.toFixed(1)}</T>
                </View>
              ))}
            </View>
          ) : null}
          {/* The two advanced options, as on the site: one quiet line under the pair, never
              buttons that compete with it. "Remove from library" only when there is a
              library entry, because un-rating deliberately does not remove one. Hidden reads
              as a state when it is on: the tinted pill with the crossed eye. */}
          <View style={styles.advanced}>
            {mine.inLibrary ? (
              // One tap used to drop a rated title for good (2026-10-23). The removal now
              // waits for the toast: Undo keeps everything, a timeout or the cross removes.
              <Pressable
                onPress={() => {
                  setRemoving(true);
                  toast(`Removed ${item.merged.title}${mine.rating != null ? ' and your rating' : ''} from your library.`, 'info', {
                    action: { label: 'Undo' },
                    onEnd: (how) => {
                      if (how === 'action') { setRemoving(false); return; }
                      act(() => removeFromLibrary(db, target).finally(() => setRemoving(false)));
                    },
                  });
                }}
                disabled={busy || removing} hitSlop={12} accessibilityRole="button" style={(busy || removing) && { opacity: 0.4 }}>
                <Text style={styles.quiet}>{removing ? 'Removing…' : 'Remove from library'}</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => act(() => setHidden(db, item.id, !hidden))} disabled={busy} hitSlop={12}
              accessibilityRole="button" {...toggled(hidden)}
              accessibilityLabel={hidden
                ? 'Hidden from your recommendations and progress. Press to unhide.'
                : 'Stop showing this in recommendations and progress. It stays searchable.'}
              style={[styles.hide, hidden && styles.hideOn, busy && { opacity: 0.4 }]}>
              {hidden ? <EyeOff size={14} color={color.accent} /> : <Eye size={14} color={color.textSecondary} />}
              <Text style={[styles.quiet, hidden && { color: color.accent }]}>{hidden ? 'Hidden, unhide' : 'Hide from suggestions'}</Text>
            </Pressable>
          </View>
          {actionError ? <T variant="caption" style={{ color: color.warning }}>{actionError}</T> : null}
        </View>
      ) : auth.status === 'signedOut' ? (
        // Shown to everybody, as on the site: a control that is missing reads as a feature that is missing.
        <View style={styles.pair}>
          <Button label="Sign in to rate" variant="secondary" size="md" icon={<Star size={14} color={color.textPrimary} />} onPress={signInFirst} style={{ flex: 1 }} />
          <Button label="Save" variant="secondary" size="md" icon={<Bookmark size={14} color={color.textPrimary} />} onPress={signInFirst} />
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
    <Screen headed wide>
      <ItemPage
        item={item}
        personal={personal}
        progress={item.type === 'show' ? <EpisodeTracker mediaItemId={item.id} tmdbId={item.vector.sources.find((s) => s.source === 'tmdb')?.sourceId ?? null} onSignIn={() => router.push('/profile' as never)} /> : undefined}
        related={<Related itemId={item.id} facets={item.facets}
          tmdbMovieId={item.type === 'movie' ? item.vector.sources.find((s) => s.source === 'tmdb')?.sourceId ?? null : null}
          igdbId={item.type === 'game' ? item.vector.sources.find((s) => s.source === 'igdb')?.sourceId ?? null : null}
          bookSeries={item.type === 'book' ? item.merged.collection ?? null : null} />}
        // The static page ends with the legal links, so in a browser this one does too.
        footer={Platform.OS === 'web' ? <LegalLinks /> : undefined}
        taxonomy={scores.taxonomy}
        onOpenFacet={(href) => router.push(href as never)}
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
  // The score panel's box while the session or the profile is still loading: 12 + 30 + 12 and the border.
  panelHold: { height: 56, borderRadius: radius.lg, borderWidth: 1, borderColor: color.border, backgroundColor: color.surfaceElevated },
  advanced: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.md, paddingTop: 4 },
  quiet: { fontFamily: font.sans, fontSize: 12, lineHeight: 16, color: color.textSecondary },
  hide: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  hideOn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.full, borderWidth: 1, borderColor: color.accentSubtle, backgroundColor: color.accentSubtle },
  actionsBlock: { gap: space.sm },
  // Ten across a 360 px screen: flex shares the row, the height is the tap target.
  stars: { flexDirection: 'row', gap: space.xs },
  star: {
    flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.sm, borderWidth: 1, borderColor: color.borderStrong,
  },
  starOn: { backgroundColor: color.accent, borderColor: color.accent },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  pair: { flexDirection: 'row', gap: space.sm },
  breakdown: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 12, rowGap: 4 },
  breakdownItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
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
