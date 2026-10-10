// "Your progress" on a show's page: the seasons, their episodes, and a tick for
// each. A port of the site's src/components/item/EpisodeTracker.tsx, size for
// size.
//
// The seasons come from the Worker; what you have watched is on this device.
// The Worker holds an episode list only for the seasons somebody opened on the
// old site, so a season without one is asked of TMDB when it is opened, which is
// when the site asked. A tick goes to Trakt first (lib/upNext.ts).
//
// Two things the site did not have, asked for on 2026-10-10: every episode
// shows its date, and a tap on an episode opens its details. The tick is its
// own target at the end of the row, so one tap has one outcome.
import { useSQLiteContext } from 'expo-sqlite';
import { Check, ChevronDown } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Img } from '~/components/Img';
import { Button, Sheet, Skeleton } from '~/components/kit';
import { useToast } from '~/components/Toast';
import { T } from '~/components/ui';
import { api, ApiError, type ShowEpisodes } from '~/lib/api';
import { useAuth } from '~/lib/AuthProvider';
import { shortDate } from '~/lib/dates';
import { tmdbEpisode, tmdbSeasonEpisodes, type EpisodeDetail } from '~/lib/tmdb';
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
  const [detail, setDetail] = useState<Episode | null>(null);

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
                      <View key={e.episode} style={[styles.episode, (busy === key || settling) && styles.dim]}>
                        <Pressable
                          onPress={() => setDetail(e)}
                          accessibilityRole="button"
                          accessibilityLabel={`${e.title || `Episode ${e.episode}`}, details`}
                          style={styles.episodeOpen}
                        >
                          <T variant="micro" style={styles.code}>{e.season}×{String(e.episode).padStart(2, '0')}</T>
                          <View style={styles.episodeText}>
                            <T variant="bodySm" style={styles.primary} numberOfLines={1}>{e.title || `Episode ${e.episode}`}</T>
                            <T variant="micro" style={styles.episodeDate}>{airLabel(e.airDate)}</T>
                          </View>
                        </Pressable>
                        <Pressable
                          onPress={() => push(key, [{ season: e.season, episode: e.episode }], !on)}
                          disabled={busy != null || settling}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: on }}
                          accessibilityLabel={`Mark ${e.title || `episode ${e.episode}`} ${on ? 'unwatched' : 'watched'}`}
                          style={styles.episodeTick}
                        >
                          {busy === key ? <ActivityIndicator size="small" color={color.textSecondary} /> : <TickBox on={on} />}
                        </Pressable>
                      </View>
                    );
                  })}
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
      <EpisodeSheet
        episode={detail}
        tmdbId={tmdbId}
        watched={detail ? watched.has(`${detail.season}:${detail.episode}`) : false}
        busy={busy != null || settling}
        onClose={() => setDetail(null)}
        onToggle={(e, next) => push(`e${e.season}-${e.episode}`, [{ season: e.season, episode: e.episode }], next)}
      />
    </View>
  );
}

/** "Oct 7, 2026", "Airs Nov 4, 2026" for one that is not out, "No date yet" when nobody has scheduled it. */
function airLabel(airDate: string | null): string {
  if (!airDate) return 'No date yet';
  const label = shortDate(airDate) ?? airDate;
  return airDate.slice(0, 10) > new Date().toISOString().slice(0, 10) ? `Airs ${label}` : label;
}

/**
 * One episode, opened: its still, when it aired, how long it runs, what happens
 * in it. The list knows the title and the date; the rest is asked of TMDB when
 * the sheet opens, and the sheet shows what it has until that answers.
 */
function EpisodeSheet({ episode, tmdbId, watched, busy, onClose, onToggle }: {
  episode: Episode | null; tmdbId: string | null; watched: boolean; busy: boolean;
  onClose: () => void; onToggle: (e: Episode, next: boolean) => void;
}) {
  const [more, setMore] = useState<EpisodeDetail | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'failed'>('idle');
  const season = episode?.season;
  const number = episode?.episode;

  useEffect(() => {
    setMore(null);
    if (season == null || number == null || !tmdbId) { setState('idle'); return; }
    const abort = new AbortController();
    setState('loading');
    tmdbEpisode(tmdbId, season, number, abort.signal)
      .then((d) => { setMore(d); setState('idle'); })
      .catch(() => { if (!abort.signal.aborted) setState('failed'); });
    return () => abort.abort();
  }, [tmdbId, season, number]);

  if (!episode) return null;
  const title = more?.title ?? episode.title ?? `Episode ${episode.episode}`;
  const airDate = more?.airDate ?? episode.airDate;
  const runtime = more?.runtimeMinutes ?? episode.runtimeMinutes;
  const unaired = !airDate || airDate.slice(0, 10) > new Date().toISOString().slice(0, 10);
  const facts = [
    `Season ${episode.season} · Episode ${episode.episode}`,
    airLabel(airDate),
    runtime ? `${runtime} min` : null,
    more?.voteAverage != null ? `${more.voteAverage.toFixed(1)}/10 on TMDB` : null,
  ].filter(Boolean).join('  ·  ');

  return (
    <Sheet open onClose={onClose} title={title}>
      <ScrollView style={{ maxHeight: 560 }} contentContainerStyle={styles.sheet}>
        {more?.stillUrl ? <View style={styles.still}><Img uri={more.stillUrl} width={480} alt="" style={styles.fill} /></View> : null}
        <View style={{ gap: space.xs }}>
          <T variant="serifMd">{title}</T>
          <T variant="meta">{facts}</T>
        </View>
        {more?.overview ? <T variant="body" style={{ color: color.textSecondary }}>{more.overview}</T>
          : state === 'loading' ? <ActivityIndicator color={color.accent} />
          : <T variant="bodySm">{state === 'failed' ? 'Could not load more about this episode. It needs a connection.' : 'No synopsis for this episode yet.'}</T>}
        <View style={styles.sheetActions}>
          <Button
            label={watched ? 'Mark unwatched' : 'Mark watched'} variant={watched ? 'outline' : 'primary'} size="md" style={{ flex: 1 }}
            disabled={busy || (unaired && !watched)} onPress={() => { onToggle(episode, !watched); onClose(); }}
          />
          <Button label="Close" variant="outline" size="md" onPress={onClose} />
        </View>
        {unaired && !watched ? <T variant="caption">It has not aired, so it cannot be marked watched yet.</T> : null}
      </ScrollView>
    </Sheet>
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
  episode: { flexDirection: 'row', alignItems: 'stretch', paddingLeft: 44 },
  episodeOpen: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 8 },
  episodeText: { flex: 1, minWidth: 0, gap: 2 },
  episodeDate: { textTransform: 'none' },
  episodeTick: { width: 52, alignItems: 'center', justifyContent: 'center' },
  code: { width: 32, textTransform: 'none' },
  sheet: { padding: 20, gap: space.lg },
  sheetActions: { flexDirection: 'row', gap: space.sm },
  still: { width: '100%', aspectRatio: 16 / 9, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: color.surfaceInset },
  fill: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },
  tick: {
    width: 20, height: 20, borderRadius: 2, borderWidth: 1, borderColor: color.borderStrong,
    alignItems: 'center', justifyContent: 'center',
  },
  tickOn: { backgroundColor: color.accent, borderColor: color.accent },
});
