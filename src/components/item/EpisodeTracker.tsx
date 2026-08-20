"use client";
import { useCallback, useEffect, useState } from "react";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import SignInDialog from "@/components/auth/SignInDialog";
import { useToast } from "@/components/ui/Toast";
import { probeSession } from "@/lib/sessionProbe";
import { SectionHeading } from "./primitives";
import { fmtDate } from "./format";

// MB14 — per-episode tracking, Showly as the UX reference: seasons collapsed
// with an n/total count, expand for the episode list, one tick to mark a whole
// season.
//
// A client island for the same reason <PersonalSection> is one: this is the only
// other per-viewer block on an otherwise session-free, server-rendered page. It
// mounts ONCE (ItemView renders one content tree — CSS visibility is not
// conditional rendering), and it is gated on `type === "show"` by its caller.
//
// ── Optimistic, with a real rollback ─────────────────────────────────────────
// A tick paints immediately and the request settles behind it: /api/episodes
// pushes to Trakt BEFORE writing locally, so a round-trip is far too slow to
// block a checkbox on, and a push Trakt refused must not leave a tick behind. On
// a non-ok response the previous state is restored and the toast says so.

interface SeasonInfo {
  seasonNumber: number;
  name: string | null;
  episodeCount: number;
  airDate: string | null;
  watchedCount: number;
}

interface EpisodeInfo {
  seasonNumber: number;
  episodeNumber: number;
  title: string | null;
  airDate: string | null;
  runtimeMinutes: number | null;
}

/** Why a show's season list came back empty — see lib/episodes.ts. */
interface CatalogDiagnostic {
  tmdbLinked: boolean;
  traktLinked: boolean;
  seasonsStored: number;
  episodesStored: number;
  tmdbCircuitOpen: boolean;
  lastError: string | null;
}

interface EpisodesResponse {
  supported?: boolean;
  diagnostic?: CatalogDiagnostic;
  seasons?: SeasonInfo[];
  episodes?: EpisodeInfo[];
  watched?: { season: number; episode: number }[];
}

export default function EpisodeTracker({ mediaItemId }: { mediaItemId: string }) {
  const { toast } = useToast();
  const [state, setState] = useState<"loading" | "anon" | "user" | "none">("loading");
  const [seasons, setSeasons] = useState<SeasonInfo[]>([]);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [episodes, setEpisodes] = useState<Record<number, EpisodeInfo[]>>({});
  const [watched, setWatched] = useState<Record<number, Set<number>>>({});
  const [loadingSeason, setLoadingSeason] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showSignIn, setShowSignIn] = useState(false);
  const [diagnostic, setDiagnostic] = useState<CatalogDiagnostic | null>(null);

  const load = useCallback(async () => {
    // Same shortcut as PersonalSection: ask the shared probe rather than firing
    // an authed request just to be told 401.
    if (!(await probeSession())) { setState("anon"); return; }
    const res = await fetch(`/api/episodes?mediaItemId=${encodeURIComponent(mediaItemId)}`);
    if (!res.ok) { setState("anon"); return; }
    const data: EpisodesResponse = await res.json();
    if (!data.supported || !data.seasons?.length) {
      setDiagnostic(data.diagnostic ?? null);
      setState("none");
      return;
    }
    setSeasons(data.seasons);
    setState("user");
  }, [mediaItemId]);

  // Fetch-on-mount: the server can't know the session, so the per-user half is
  // resolved here. Every setState below happens after an await, not synchronously
  // in the effect body — the same justified disable PersonalSection carries.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  async function toggleOpen(seasonNumber: number) {
    const next = new Set(open);
    if (next.has(seasonNumber)) {
      next.delete(seasonNumber);
      setOpen(next);
      return;
    }
    next.add(seasonNumber);
    setOpen(next);
    if (episodes[seasonNumber]) return;

    // First expand of this season is what fills its episode list — one TMDB
    // call server-side, then never again for a week.
    setLoadingSeason(seasonNumber);
    try {
      const res = await fetch(
        `/api/episodes?mediaItemId=${encodeURIComponent(mediaItemId)}&season=${seasonNumber}`,
      );
      if (!res.ok) throw new Error(String(res.status));
      const data: EpisodesResponse = await res.json();
      setEpisodes((p) => ({ ...p, [seasonNumber]: data.episodes ?? [] }));
      setWatched((p) => ({
        ...p,
        [seasonNumber]: new Set((data.watched ?? []).map((w) => w.episode)),
      }));
      if (data.seasons?.length) setSeasons(data.seasons);
    } catch {
      toast("Couldn't load that season.", "error");
      setEpisodes((p) => ({ ...p, [seasonNumber]: [] }));
    } finally {
      setLoadingSeason(null);
    }
  }

  // One writer for both the per-episode tick and the season header tick, so the
  // optimistic paint and the rollback can't drift between them.
  async function push(
    seasonNumber: number,
    payload: Record<string, unknown>,
    optimistic: () => void,
    busyKey: string,
  ) {
    const prevSeasons = seasons;
    const prevWatched = watched[seasonNumber];
    optimistic();
    setBusy(busyKey);
    try {
      const res = await fetch("/api/episodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaItemId, ...payload }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Request failed (${res.status})`);
      }
      const data = await res.json();
      // Reconcile the header counts with what the server actually recorded —
      // the optimistic number is a guess, this is the truth.
      const counts: Record<number, number> = data.watchedCount ?? {};
      setSeasons((prev) => prev.map((s) => ({ ...s, watchedCount: counts[s.seasonNumber] ?? 0 })));
    } catch (e) {
      setSeasons(prevSeasons);
      setWatched((p) => {
        const next = { ...p };
        if (prevWatched) next[seasonNumber] = prevWatched;
        else delete next[seasonNumber];
        return next;
      });
      toast(e instanceof Error ? e.message : "Couldn't save that.", "error");
    } finally {
      setBusy(null);
    }
  }

  function toggleEpisode(seasonNumber: number, episodeNumber: number, next: boolean) {
    void push(
      seasonNumber,
      { watched: next, episodes: [{ season: seasonNumber, episode: episodeNumber }] },
      () => {
        setWatched((p) => {
          const set = new Set(p[seasonNumber] ?? []);
          if (next) set.add(episodeNumber);
          else set.delete(episodeNumber);
          return { ...p, [seasonNumber]: set };
        });
        setSeasons((prev) =>
          prev.map((s) =>
            s.seasonNumber === seasonNumber
              ? { ...s, watchedCount: Math.max(0, s.watchedCount + (next ? 1 : -1)) }
              : s,
          ),
        );
      },
      `e${seasonNumber}-${episodeNumber}`,
    );
  }

  function toggleSeason(season: SeasonInfo, next: boolean) {
    void push(
      season.seasonNumber,
      { watched: next, season: season.seasonNumber },
      () => {
        const known = episodes[season.seasonNumber];
        setWatched((p) => ({
          ...p,
          [season.seasonNumber]: next
            ? new Set((known ?? []).map((e) => e.episodeNumber))
            : new Set<number>(),
        }));
        setSeasons((prev) =>
          prev.map((s) =>
            s.seasonNumber === season.seasonNumber
              ? { ...s, watchedCount: next ? s.episodeCount : 0 }
              : s,
          ),
        );
      },
      `s${season.seasonNumber}`,
    );
  }

  if (state === "loading") {
    return <div className="h-20 rounded-xl border border-border bg-neutral-900/40 animate-pulse" />;
  }
  // A show with NO season list used to render nothing at all — the same
  // silent-null this module's Home counterpart had. It hid the actual failure
  // (no TMDB link / an open circuit / TMDB returning nothing) behind a blank
  // page on every show at once, which is exactly how it looked to Nils. It now
  // says which, because from a phone there is no other way to find out.
  if (state === "none") {
    const why = catalogReason(diagnostic);
    if (!why) return null;
    return (
      <section className="mt-8">
        <SectionHeading>Your progress</SectionHeading>
        <p className="text-body-sm text-text-secondary">{why}</p>
      </section>
    );
  }

  if (state === "anon") {
    return (
      <section className="mt-8">
        <SectionHeading>Your progress</SectionHeading>
        <button
          onClick={() => setShowSignIn(true)}
          className="w-full rounded-xl border border-border bg-surface-elevated px-4 py-3 text-body-sm text-text-secondary hover:text-text-primary hover:border-border-strong transition-colors text-left"
        >
          Sign in to track episodes →
        </button>
        {showSignIn && (
          <SignInDialog
            type="show"
            returnTo={typeof window !== "undefined" ? window.location.pathname : "/"}
            onClose={() => setShowSignIn(false)}
            onAuthenticated={() => { setShowSignIn(false); void load(); }}
          />
        )}
      </section>
    );
  }

  const totalEpisodes = seasons.reduce((n, s) => n + s.episodeCount, 0);
  const totalWatched = seasons.reduce((n, s) => n + Math.min(s.watchedCount, s.episodeCount), 0);

  return (
    <section className="mt-8">
      <SectionHeading>Your progress</SectionHeading>
      <p className="text-caption text-text-secondary mb-3">
        {totalWatched} of {totalEpisodes} watched
      </p>

      <ul className="rounded-xl border border-border overflow-hidden divide-y divide-border">
        {seasons.map((s) => {
          const isOpen = open.has(s.seasonNumber);
          const seen = Math.min(s.watchedCount, s.episodeCount);
          const complete = s.episodeCount > 0 && seen >= s.episodeCount;
          const seasonBusy = busy === `s${s.seasonNumber}`;
          return (
            <li key={s.seasonNumber} className="bg-surface-elevated">
              <div className="flex items-stretch">
                <button
                  onClick={() => void toggleOpen(s.seasonNumber)}
                  aria-expanded={isOpen}
                  className="flex-1 min-w-0 flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.03] transition-colors"
                >
                  <ChevronDown
                    className={`w-4 h-4 shrink-0 text-text-secondary transition-transform ${isOpen ? "rotate-180" : ""}`}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-body-sm text-text-primary truncate">
                      {s.name || `Season ${s.seasonNumber}`}
                    </span>
                    <span className="block font-mono text-micro text-text-secondary mt-0.5">
                      {seen}/{s.episodeCount}
                      {s.airDate ? ` · ${fmtDate(s.airDate)}` : ""}
                    </span>
                  </span>
                  <span
                    className="hidden sm:block w-20 h-1 rounded-full bg-white/10 overflow-hidden shrink-0"
                    aria-hidden
                  >
                    <span
                      className="block h-full bg-accent"
                      style={{ width: s.episodeCount ? `${(seen / s.episodeCount) * 100}%` : "0%" }}
                    />
                  </span>
                </button>
                <button
                  onClick={() => toggleSeason(s, !complete)}
                  disabled={seasonBusy || s.episodeCount === 0}
                  aria-pressed={complete}
                  aria-label={complete ? `Mark season ${s.seasonNumber} unwatched` : `Mark season ${s.seasonNumber} watched`}
                  className="w-12 shrink-0 flex items-center justify-center border-l border-border hover:bg-white/[0.03] transition-colors disabled:opacity-40"
                >
                  {seasonBusy ? (
                    <Loader2 className="w-4 h-4 animate-spin text-text-secondary" aria-hidden />
                  ) : (
                    <TickBox on={complete} />
                  )}
                </button>
              </div>

              {isOpen && (
                <div className="border-t border-border">
                  {loadingSeason === s.seasonNumber ? (
                    <p className="px-4 py-3 text-caption text-text-secondary">Loading episodes…</p>
                  ) : (episodes[s.seasonNumber]?.length ?? 0) === 0 ? (
                    <p className="px-4 py-3 text-caption text-text-secondary">
                      No episode list available for this season.
                    </p>
                  ) : (
                    <ul>
                      {episodes[s.seasonNumber].map((e) => {
                        const on = watched[s.seasonNumber]?.has(e.episodeNumber) ?? false;
                        const key = `e${s.seasonNumber}-${e.episodeNumber}`;
                        return (
                          <li key={e.episodeNumber}>
                            <button
                              onClick={() => toggleEpisode(s.seasonNumber, e.episodeNumber, !on)}
                              disabled={busy === key}
                              aria-pressed={on}
                              className="w-full flex items-center gap-3 pl-11 pr-4 py-2.5 text-left hover:bg-white/[0.03] transition-colors disabled:opacity-50"
                            >
                              <span className="font-mono text-micro text-text-secondary w-8 shrink-0">
                                {s.seasonNumber}×{String(e.episodeNumber).padStart(2, "0")}
                              </span>
                              <span className="min-w-0 flex-1 text-body-sm text-text-primary truncate">
                                {e.title || `Episode ${e.episodeNumber}`}
                              </span>
                              {e.airDate && (
                                <span className="hidden sm:block font-mono text-micro text-text-secondary shrink-0">
                                  {fmtDate(e.airDate)}
                                </span>
                              )}
                              {busy === key ? (
                                <Loader2 className="w-4 h-4 animate-spin text-text-secondary shrink-0" aria-hidden />
                              ) : (
                                <TickBox on={on} />
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// The tick itself. A span, not an <input>: the whole row is the control, and the
// button that wraps it already carries aria-pressed + an accessible name.
function TickBox({ on }: { on: boolean }) {
  return (
    <span
      className={`w-5 h-5 rounded-sm border flex items-center justify-center shrink-0 transition-colors ${
        on ? "bg-accent border-accent" : "border-border-strong"
      }`}
      aria-hidden
    >
      {on && <Check className="w-3.5 h-3.5 text-surface" strokeWidth={3} />}
    </span>
  );
}

/**
 * Why this show has no season list. Returns null when there is nothing useful
 * to say — a movie, or a show whose catalog genuinely holds no seasons and
 * never errored, where a message would be noise.
 */
function catalogReason(d: CatalogDiagnostic | null): string | null {
  if (!d) return null;
  // Neither catalog source is linked — nothing can be asked for this show.
  if (!d.tmdbLinked && !d.traktLinked) {
    return "This show isn't linked to TMDB or Trakt yet, so there's no episode list to show.";
  }
  if (d.lastError) return `Couldn't load the episode list. ${d.lastError}`;
  if (d.tmdbLinked && d.tmdbCircuitOpen) {
    return "TMDB is unreachable right now. Episodes will fill in once it recovers.";
  }
  return null;
}
