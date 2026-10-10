// "Your progress" on a show's page: the seasons, their episodes, and a tick for
// each. A port of the site's src/components/item/EpisodeTracker.tsx, size for
// size.
//
// The seasons come from the Worker; what you have watched is on this device.
// The Worker holds an episode list only for the seasons somebody opened on the
// old site, so a season without one is asked of TMDB when it is opened, which is
// when the site asked. A tick goes to Trakt first (lib/upNext.ts).
import { useSQLiteContext } from 'expo-sqlite';
import { Check, ChevronDown } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Skeleton } from '~/components/kit';
import { useToast } from '~/components/Toast';
import { T } from '~/components/ui';
import { api, ApiError, type ShowEpisodes } from '~/lib/api';
import { useAuth } from '~/lib/AuthProvider';
import { shortDate } from '~/lib/dates';
import { tmdbSeasonEpisodes } from '~/lib/tmdb';
import { TraktAuthError } from '~/lib/trakt';
import { setEpisodesWatched } from '~/lib/upNext';
import { breakpoint, color, radius, space } from '~/theme';

type Episode = ShowEpisodes['episodes'][number];

/** Why a tick did not save, in words. */
function failure(e: unknown): string {
  if (e instanceof TraktAuthError) return 'Trakt needs you to sign in again. You can do that in Settings.';
  if (e instanceof ApiError && e.code === 'offline') return 'No connection. Nothing was changed.';
  if (e instanceof ApiError && e.code === 'budget-exhausted') return 'Fandex cannot save more changes until tomorrow.';
  if (e instanceof ApiError) return 'Fandex could not save that. Nothing was changed.';
  return e instanceof Error ? e.message : 'That did not work. Nothing was changed.';
}

export function EpisodeTracker({ mediaItemId, tmdbId, onSignIn }: {
  mediaItemId: string;
  /** The show's TMDB id, for the seasons the catalog holds no episodes for. */
  tmdbId: string | null;
  onSignIn: () => void;
}) {
  const db = useSQLiteContext();
  const auth = useAuth();
  const { toast } = useToast();
  const { width } = useWindowDimensions();
  const roomy = width >= breakpoint.sm;

  const [catalog, setCatalog] = useState<ShowEpisodes | null>(null);
  const [failed, setFailed] = useState(false);
  const [watched, setWatched] = useState<Set<string>>(new Set());
  const [watchedCount, setWatchedCount] = useState<Record<number, number>>({});
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [fetched, setFetched] = useState<Record<number, Episode[]>>({});
  const [loadingSeason, setLoadingSeason] = useState<number | null>(null);

  const signedIn = auth.status === 'signedIn';

  useEffect(() => {
    let live = true;
    setCatalog(null);
    setFailed(false);
    setFetched({});
    setOpen(new Set());
    api.showEpisodes(mediaItemId)
      .then((c) => { if (live) setCatalog(c); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [mediaItemId]);

  const loadWatched = useCallback(async () => {
    const rows = await db.getAllAsync<{ season: number; episode: number }>(
      'SELECT season, episode FROM episode_state WHERE media_item_id = ?', [mediaItemId],
    );
    setWatched(new Set(rows.map((r) => `${r.season}:${r.episode}`)));
    const counts: Record<number, number> = {};
    for (const r of rows) counts[r.season] = (counts[r.season] ?? 0) + 1;
    setWatchedCount(counts);
  }, [db, mediaItemId]);

  useEffect(() => {
    if (signedIn) void loadWatched();
    else { setWatched(new Set()); setWatchedCount({}); }
  }, [signedIn, loadWatched, auth.rowsRevision]);

  const bySeason = useMemo(() => {
    const map = new Map<number, Episode[]>();
    for (const e of catalog?.episodes ?? []) map.set(e.season, [...(map.get(e.season) ?? []), e]);
    for (const [season, list] of Object.entries(fetched)) if (!map.has(Number(season))) map.set(Number(season), list);
    return map;
  }, [catalog, fetched]);

  if (auth.status === 'loading' || (!catalog && !failed)) {
    return <Skeleton style={styles.loading} />;
  }

  if (auth.status === 'signedOut') {
    return (
      <View>
        <T variant="eyebrow" style={styles.heading}>Your progress</T>
        <Pressable onPress={onSignIn} accessibilityRole="button" style={styles.signIn}>
          <T variant="bodySm">Sign in to track episodes →</T>
        </Pressable>
      </View>
    );
  }

  // Empty is said, not hidden: a show with no list here looks exactly like a
  // tracker that failed to load.
  if (failed || !catalog?.seasons.length) {
    return (
      <View>
        <T variant="eyebrow" style={styles.heading}>Your progress</T>
        <T variant="bodySm">
          {failed
            ? 'Could not load the episode list. It needs a connection.'
            : 'Fandex has no episode list for this show yet.'}
        </T>
      </View>
    );
  }

  const seasons = catalog.seasons;
  // Counted from your rows, not from the episode list: a season whose list is
  // not loaded yet still knows how many of it you have watched.
  const seen = (season: number) => watchedCount[season] ?? 0;

  /** The season's episodes, asking TMDB when the catalog holds none. */
  const ensureSeason = async (season: number): Promise<Episode[]> => {
    const known = bySeason.get(season);
    if (known?.length) return known;
    if (!tmdbId) return [];
    setLoadingSeason(season);
    try {
      const list = await tmdbSeasonEpisodes(tmdbId, season);
      setFetched((p) => ({ ...p, [season]: list }));
      return list;
    } finally {
      setLoadingSeason(null);
    }
  };
  // Your rows are still on their way (a fresh tab, a new sign-in). What is on
  // the device is not yet what you have watched, and a tick made from it would
  // be a second play on Trakt.
  const settling = auth.rowsSyncing;
  const total = seasons.reduce((n, s) => n + s.episodeCount, 0);
  const totalSeen = seasons.reduce((n, s) => n + Math.min(seen(s.season), s.episodeCount), 0);

  const push = (key: string, episodes: { season: number; episode: number }[], next: boolean) => {
    // Only what actually changes is sent: an episode already in the state asked
    // for would be a second play on Trakt.
    const changing = episodes.filter((e) => watched.has(`${e.season}:${e.episode}`) !== next);
    if (!changing.length) return;
    const optimistic = new Set(watched);
    const counts = { ...watchedCount };
    for (const e of changing) {
      if (next) optimistic.add(`${e.season}:${e.episode}`);
      else optimistic.delete(`${e.season}:${e.episode}`);
      counts[e.season] = Math.max(0, (counts[e.season] ?? 0) + (next ? 1 : -1));
    }
    setWatched(optimistic);
    setWatchedCount(counts);
    setBusy(key);
    setEpisodesWatched(db, mediaItemId, changing, next)
      .then(() => auth.rowsChanged())
      .catch((e: unknown) => {
        // Read the device again, never put a snapshot back: your rows may have
        // arrived while the request was out, and a snapshot from before that
        // would paint a watched show as unwatched.
        void loadWatched();
        toast(failure(e), 'error');
      })
      .finally(() => setBusy(null));
  };

  return (
    <View>
      <T variant="eyebrow" style={styles.heading}>Your progress</T>
      <T variant="caption" style={styles.summary}>{settling ? 'Fetching what you have watched…' : `${totalSeen} of ${total} watched`}</T>
      <View style={styles.list}>
        {seasons.map((s, i) => {
          const isOpen = open.has(s.season);
          const episodes = bySeason.get(s.season) ?? [];
          const done = Math.min(seen(s.season), s.episodeCount);
          const complete = s.episodeCount > 0 && done >= s.episodeCount;
          const seasonKey = `s${s.season}`;
          return (
            <View key={s.season} style={[styles.season, i > 0 && styles.divided]}>
              <View style={styles.seasonRow}>
                <Pressable
                  onPress={() => {
                    setOpen((prev) => {
                      const next = new Set(prev);
                      if (next.has(s.season)) next.delete(s.season);
                      else next.add(s.season);
                      return next;
                    });
                    if (!isOpen) void ensureSeason(s.season).catch(() => toast('Could not load that season.', 'error'));
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: isOpen }}
                  style={styles.seasonOpen}
                >
                  <View style={isOpen ? styles.turned : undefined}>
                    <ChevronDown size={16} color={color.textSecondary} />
                  </View>
                  <View style={styles.seasonText}>
                    <T variant="bodySm" style={styles.primary} numberOfLines={1}>{s.name || `Season ${s.season}`}</T>
                    <T variant="micro" style={styles.seasonMeta}>
                      {done}/{s.episodeCount}{s.airDate ? ` · ${shortDate(s.airDate)}` : ''}
                    </T>
                  </View>
                  {roomy ? (
                    <View style={styles.bar}>
                      <View style={[styles.barFill, { width: `${s.episodeCount ? (done / s.episodeCount) * 100 : 0}%` }]} />
                    </View>
                  ) : null}
                </Pressable>
                <Pressable
                  onPress={() => {
                    setBusy(seasonKey);
                    ensureSeason(s.season)
                      .then((list) => {
                        setBusy(null);
                        if (!list.length) toast('No episodes known for that season.', 'error');
                        else push(seasonKey, list.map((e) => ({ season: e.season, episode: e.episode })), !complete);
                      })
                      .catch(() => { setBusy(null); toast('Could not load that season.', 'error'); });
                  }}
                  disabled={busy != null || settling || s.episodeCount === 0}
                  accessibilityRole="button"
                  accessibilityState={{ selected: complete }}
                  accessibilityLabel={complete ? `Mark season ${s.season} unwatched` : `Mark season ${s.season} watched`}
                  style={[styles.seasonTick, (busy === seasonKey || settling || s.episodeCount === 0) && styles.dim]}
                >
                  {busy === seasonKey ? <ActivityIndicator size="small" color={color.textSecondary} /> : <TickBox on={complete} />}
                </Pressable>
              </View>
              {isOpen ? (
                <View style={styles.divided}>
                  {loadingSeason === s.season ? (
                    <T variant="caption" style={styles.none}>Loading episodes…</T>
                  ) : episodes.length === 0 ? (
                    <T variant="caption" style={styles.none}>No episode list available for this season.</T>
                  ) : episodes.map((e) => {
                    const on = watched.has(`${e.season}:${e.episode}`);
                    const key = `e${e.season}-${e.episode}`;
                    return (
                      <Pressable
                        key={e.episode}
                        onPress={() => push(key, [{ season: e.season, episode: e.episode }], !on)}
                        disabled={busy != null || settling}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on }}
                        style={[styles.episode, (busy === key || settling) && styles.dim]}
                      >
                        <T variant="micro" style={styles.code}>{e.season}×{String(e.episode).padStart(2, '0')}</T>
                        <T variant="bodySm" style={[styles.primary, styles.episodeTitle]} numberOfLines={1}>
                          {e.title || `Episode ${e.episode}`}
                        </T>
                        {roomy && e.airDate ? <T variant="micro">{shortDate(e.airDate)}</T> : null}
                        {busy === key ? <ActivityIndicator size="small" color={color.textSecondary} /> : <TickBox on={on} />}
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

function TickBox({ on }: { on: boolean }) {
  return (
    <View style={[styles.tick, on && styles.tickOn]}>
      {on ? <Check size={14} color={color.surface} strokeWidth={3} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { height: 80, borderRadius: radius.lg },
  heading: { color: color.accent, marginBottom: space.md },
  summary: { marginBottom: space.md },
  primary: { color: color.textPrimary },
  signIn: {
    paddingHorizontal: space.lg, paddingVertical: space.md,
    borderRadius: radius.lg, borderWidth: 1, borderColor: color.border, backgroundColor: color.surfaceElevated,
  },
  list: { borderRadius: radius.lg, borderWidth: 1, borderColor: color.border, overflow: 'hidden' },
  season: { backgroundColor: color.surfaceElevated },
  divided: { borderTopWidth: 1, borderTopColor: color.border },
  seasonRow: { flexDirection: 'row', alignItems: 'stretch' },
  seasonOpen: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md },
  turned: { transform: [{ rotate: '180deg' }] },
  seasonText: { flex: 1, minWidth: 0 },
  seasonMeta: { marginTop: 2, textTransform: 'none' },
  bar: { width: 80, height: 4, borderRadius: radius.full, backgroundColor: 'rgba(255,255,255,0.1)', overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: color.accent },
  seasonTick: { width: 48, alignItems: 'center', justifyContent: 'center', borderLeftWidth: 1, borderLeftColor: color.border },
  dim: { opacity: 0.5 },
  none: { paddingHorizontal: space.lg, paddingVertical: space.md },
  episode: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingLeft: 44, paddingRight: space.lg, paddingVertical: 10 },
  code: { width: 32, textTransform: 'none' },
  episodeTitle: { flex: 1, minWidth: 0 },
  tick: {
    width: 20, height: 20, borderRadius: 2, borderWidth: 1, borderColor: color.borderStrong,
    alignItems: 'center', justifyContent: 'center',
  },
  tickOn: { backgroundColor: color.accent, borderColor: color.accent },
});
