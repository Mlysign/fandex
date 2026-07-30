"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { Star, Bookmark } from "lucide-react";
import type { EnrichedItem, MediaType } from "@/types";
import type { PlatformStatus } from "@/lib/watchlistStatus";
import type { IntentAction} from "@/lib/pendingIntent";
import { stashIntent, takeIntent } from "@/lib/pendingIntent";
import { probeSession } from "@/lib/sessionProbe";
import SignInDialog from "@/components/auth/SignInDialog";
import { StarPicker } from "@/components/ActionCells";
import { fmtScore } from "./format";
import RatingsSection from "./RatingsSection";
import WishlistPanel from "./WishlistPanel";
import FandexScoreSection from "./FandexScoreSection";
import type { Reason } from "@/components/discovery/types";

// P13 — the ONE section that differs between a logged-out and a logged-in
// viewer, on the ONE shared item url.
//
// The page around this is server-rendered WITHOUT user data (so it's fast,
// cacheable, crawlable and unfurls), and this island fills in the per-user half
// on the client:
//   401 → the REAL controls, but every interaction opens the sign-in dialog and
//         remembers what you were doing (H2c login-with-intent)
//   200 → the real Fandex Score, rate/save controls and wishlist panel
//
// It deliberately owns ALL the per-user state. The server render must never
// depend on a session, or the public HTML would vary per user and the SSR
// guarantee (and any future caching) breaks.

interface DetailResponse {
  item?: Partial<EnrichedItem>;
  platforms?: PlatformStatus[];
  resolvedMediaItemId?: string | null;
  onAnyList?: boolean;
  fandexReasons?: Reason[];
  fandexCenter?: number | null;
  fandexColdStart?: boolean;
}

export default function PersonalSection({
  itemId,
  type,
  ids,
  title,
  releaseDate,
  posterUrl,
  steamStoreUrl,
}: {
  /** Always a uuid since H2b (discover persists → every item has one). */
  itemId: string;
  type: MediaType;
  /** Source ids, forwarded on writes so the server can attach cross-ids. */
  ids: Record<string, string | number>;
  title: string;
  releaseDate: string | null;
  posterUrl: string | null;
  steamStoreUrl: string | null;
}) {
  const [state, setState] = useState<"loading" | "anon" | "user">("loading");
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [mediaItemId, setMediaItemId] = useState<string | null>(null);
  const [ratingAction, setRatingAction] = useState(false);
  const [platformAction, setPlatformAction] = useState<string | null>(null);
  const [saveAction, setSaveAction] = useState(false);
  const [showSignIn, setShowSignIn] = useState(false);
  const [picking, setPicking] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  // `ids` is an object literal rebuilt by the parent on EVERY render, so
  // depending on it directly would give `load` a new identity each render → the
  // effect refires → setState → render → refire: an infinite fetch loop. Depend
  // on a serialized key instead, which only changes when the ids really do.
  const idsKey = JSON.stringify(ids);

  const load = useCallback(async () => {
    // SM6: don't fire the authed /api/detail just to learn we're logged out —
    // the shared probe answers that without a 401.
    if (!(await probeSession())) { setState("anon"); return; }
    const p = new URLSearchParams({ id: itemId, type });
    for (const [k, v] of Object.entries(JSON.parse(idsKey) as Record<string, string>)) {
      if (v != null) p.set(`${k}Id`, String(v));
    }
    const res = await fetch(`/api/detail?${p}`);
    // Any failure (incl. a race with logout) degrades to the anon controls.
    if (!res.ok) { setState("anon"); return; }
    const data: DetailResponse = await res.json();
    setDetail(data);
    setMediaItemId(data.resolvedMediaItemId ?? null);
    setState("user");
  }, [itemId, type, idsKey]);

  // Fetch-on-mount: this is the whole point of the island — the server can't
  // know the session, so the per-user half is resolved here. `load` is async, so
  // its setState calls all happen after an await, not synchronously in the
  // effect body; the rule can't see through the callback. Same justified disable
  // the discover + insights/facet pages already use for this pattern.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const body = (extra: Record<string, unknown>) =>
    mediaItemId ? { mediaItemId, ...extra } : { type, title, releaseDate, posterUrl, ids, ...extra };

  async function handleRate(n: number | null) {
    setRatingAction(true);
    try {
      const res = await fetch("/api/library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body({ rating: n })),
      });
      const data = await res.json().catch(() => ({}));
      if (data.mediaItemId && !mediaItemId) setMediaItemId(data.mediaItemId);
      await load();
    } finally {
      setRatingAction(false);
    }
  }

  // B6 (2026-07-28) — the "Save" button's generic all-providers toggle:
  // no targetProvider on add (POST writes every writable connected provider),
  // no source on remove (DELETE clears every provider link). The per-provider
  // fine-grained toggles stay available below in WishlistPanel.
  async function toggleSave() {
    const onList = !!detail?.onAnyList;
    setSaveAction(true);
    try {
      if (onList) {
        await fetch("/api/watchlist", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mediaItemId: mediaItemId ?? undefined, ids }),
        });
      } else {
        await fetch("/api/watchlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type, title, releaseDate, posterUrl, ids }),
        });
      }
      await load();
    } finally {
      setSaveAction(false);
    }
  }

  async function togglePlatform(provider: string, onList: boolean) {
    setPlatformAction(provider);
    try {
      if (onList) {
        await fetch("/api/watchlist", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mediaItemId: mediaItemId ?? itemId, source: provider }),
        });
      } else {
        await fetch("/api/watchlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type, title, releaseDate, ids, targetProvider: provider }),
        });
      }
      await load();
    } finally {
      setPlatformAction(null);
    }
  }

  // ── H2c login-with-intent ───────────────────────────────────────────────────
  // Anon interaction: stash what they wanted (keyed to THIS item's path) and open
  // the sign-in dialog. The redirect providers leave the page; RAWG stays.
  const requestAuth = (action: IntentAction) => {
    stashIntent({ path: window.location.pathname, action });
    setShowSignIn(true);
  };

  // Drain the stashed intent exactly once, the first time we resolve to a signed-
  // in viewer. Covers BOTH resume paths: the redirect providers (fresh page load
  // lands back here via the return cookie) and RAWG (onAuthenticated re-runs
  // load(), flipping state to "user"). By the time state === "user", `detail` and
  // `mediaItemId` are set, so the normal handlers apply.
  const drained = useRef(false);
  useEffect(() => {
    if (state !== "user" || drained.current) return;
    drained.current = true;
    const intent = takeIntent(window.location.pathname);
    if (!intent) return;
    // Defer the dispatch out of the effect body: the handlers setState
    // synchronously (a loading flag), and firing that inside the effect trips the
    // cascading-render rule. A microtask runs right after commit — same tick, no
    // synchronous re-render.
    queueMicrotask(() => {
      if (intent.action.kind === "rate") void handleRate(intent.action.value);
      else if (intent.action.kind === "wishlist") void toggleSave();
    });
    // handlers/detail are intentionally omitted: this must fire once, on the
    // state transition, with the values current at that point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // Dismiss the star picker on any click/tap outside it (same pattern as
  // ActionCells' own StarPicker use).
  useEffect(() => {
    if (!picking) return;
    const onDown = (e: PointerEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPicking(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [picking]);

  // Reserve the height while loading so the server-rendered content above
  // doesn't jump once this resolves.
  if (state === "loading") {
    return <div className="h-24 rounded-xl border border-border bg-neutral-900/40 animate-pulse" />;
  }

  const item = detail?.item ?? {};
  const anon = state === "anon";
  const rated = !anon && typeof item.rating === "number" && item.rating > 0;
  const wishlisted = !anon && !!detail?.onAnyList;
  // h-11 is already the 44px tap minimum, so (unlike ActionCells' barBtn)
  // this needs no .tap-44-y padding trick.
  const barBtn = "flex items-center justify-center gap-1.5 rounded-sm border transition-colors disabled:opacity-50 h-11";

  // Anon still opens the same star popover (not just a flat CTA) — picking a
  // star stashes the H2c "rate" intent with that value instead of applying it
  // immediately, so a value chosen before signing in still lands after.
  //
  // `n === null` is the picker's toggle-off (re-clicking your current rating).
  // Unreachable for anon — they have no rating to clear — but the type carries
  // through because `IntentAction` has always allowed a null value.
  const onPickStar = (n: number | null) => {
    if (anon) requestAuth({ kind: "rate", value: n });
    else void handleRate(n);
    setPicking(false);
  };

  return (
    <div className="space-y-4">
      {/* H5.3/B6 — the Fandex Score panel: gated for anon, else scored /
          cold-start / unscorable per FandexScoreSection's own logic. */}
      <FandexScoreSection
        anon={anon}
        score={anon ? null : (item.fandexScore ?? null)}
        center={anon ? null : (detail?.fandexCenter ?? null)}
        reasons={anon ? [] : (detail?.fandexReasons ?? [])}
        coldStart={!anon && !!detail?.fandexColdStart}
      />

      {/* B6 (2026-07-28) — the mockup's two-button pair: Rate it / Save.
          Anon interactions still stash the intent (H2c) via the same star
          popover / sign-in dialog once resolved. */}
      <div className="relative" ref={pickerRef}>
        <div className="flex gap-2">
          <button
            onClick={() => setPicking((v) => !v)}
            disabled={ratingAction}
            aria-haspopup="true"
            aria-expanded={picking}
            className={`${barBtn} flex-1 text-sm font-medium`}
            style={rated
              ? { background: "var(--color-accent-subtle)", borderColor: "var(--color-accent-subtle)", color: "var(--color-accent)" }
              : { background: "rgb(237 231 220 / 0.06)", borderColor: "rgb(237 231 220 / 0.07)", color: "var(--color-text-primary)" }}
          >
            <Star className="w-4 h-4 shrink-0" fill={rated ? "currentColor" : "none"} aria-hidden />
            {rated ? `${fmtScore(item.rating!)}/10` : anon ? "Sign in to rate" : "Rate it"}
          </button>
          <button
            onClick={() => (anon ? requestAuth({ kind: "wishlist" }) : void toggleSave())}
            disabled={saveAction}
            aria-pressed={wishlisted}
            className={`${barBtn} px-4 text-sm font-medium`}
            style={wishlisted
              ? { background: "var(--color-accent-subtle)", borderColor: "var(--color-accent-subtle)", color: "var(--color-accent)" }
              : { background: "rgb(237 231 220 / 0.06)", borderColor: "rgb(237 231 220 / 0.07)", color: "var(--color-text-secondary)" }}
          >
            <Bookmark className="w-4 h-4" fill={wishlisted ? "currentColor" : "none"} aria-hidden />
            Save
          </button>
        </div>
        {picking && (
          <div className="absolute z-30 top-full mt-1.5 left-0">
            <StarPicker rating={anon ? null : (item.rating ?? null)} onPick={onPickStar} />
          </div>
        )}
      </div>
      {anon && steamStoreUrl && (
        <a href={steamStoreUrl} target="_blank" rel="noopener noreferrer" className="block text-xs text-text-secondary hover:text-text-primary transition-colors">
          View on Steam →
        </a>
      )}

      <RatingsSection
        hasScores={false} /* community scores are server-rendered above */
        communityRatings={[]}
        steamReview={null}
        personalRating={anon ? null : (item.rating ?? null)}
        personalRatings={anon ? [] : (item.ratings ?? [])}
        libraryStatus={anon ? null : (item.libraryStatus ?? null)}
        reviewedAt={anon ? null : (item.reviewedAt ?? null)}
        review={anon ? null : (item.review ?? null)}
      />

      {!anon && (
        <WishlistPanel
          platforms={detail?.platforms ?? []}
          loading={false}
          platformAction={platformAction}
          onToggle={togglePlatform}
          steamStoreUrl={steamStoreUrl}
        />
      )}

      {showSignIn && (
        <SignInDialog
          type={type}
          returnTo={typeof window !== "undefined" ? window.location.pathname : "/"}
          onClose={() => setShowSignIn(false)}
          // RAWG login sets the session in-place (no redirect): close + reload the
          // island; the drain effect then resumes the stashed intent.
          onAuthenticated={() => { setShowSignIn(false); void load(); }}
        />
      )}
    </div>
  );
}
