"use client";
import { useState } from "react";
import type { EnrichedItem } from "@/types";
import type { PublicEnrichedItem } from "@/lib/detail/enrich";
import { SOURCE_COLORS, SOURCE_LABELS, TYPE_COLORS } from "@/lib/constants";
import { fmtDate, fmtRuntime } from "./format";
import MediaGallery from "./MediaGallery";
import DetailHero from "./DetailHero";
import RatingsSection from "./RatingsSection";
import FactsSection from "./FactsSection";
import LowerSections from "./LowerSections";
import PersonalSection from "./PersonalSection";
import EpisodeTracker from "./EpisodeTracker";
import SimilarRail from "./SimilarRail";
import BackButton from "@/components/ui/BackButton";
import { useMediaQuery } from "@/lib/useMediaQuery";
import type { TagDisplayCategory } from "@/lib/tags";

// P13 — THE item view. One page, one url, for everyone.
//
// Everything here renders from `item`, which the SERVER built with no user data:
// gallery, title, dates, community scores, facts, credits, trailer, cast,
// where-to-watch, tags. That's why a logged-out visitor (and a crawler, and a
// link unfurler) sees the full page.
//
// The single per-user block — your rating + wishlist — is <PersonalSection>, a
// client island that checks the session itself and swaps between a sign-in hook
// and the real interactive controls. Nothing above it may depend on a session,
// or the server HTML would vary per viewer and the SSR guarantee would break.
//
// ── 2026-07-30 LAYOUT REBUILD ───────────────────────────────────────────────
// Nils: "the web layout is very jagged, it does not match the mockup." Both were
// true, and the mockup (04-pages/item-detail.html) is MOBILE-ONLY — five 360px
// frames, no desktop frame — so "match the mockup" can't mean one layout:
//
//   • MOBILE now follows the mockup's anatomy exactly: full-bleed 3:4 hero with
//     overlaid back/share and the title in the scrim → Fandex Score panel →
//     Rate/Save → ★ line → synopsis → cast → facts → where-to-watch.
//   • DESKTOP is DERIVED from it rather than a second design: the same section
//     order, a capped sticky gallery column, and prose capped at 68ch.
//
// The jaggedness itself was three competing rhythms stacked in one column — a
// 420px gallery next to a `space-y-5` stack containing a `grid-cols-2
// sm:grid-cols-3` facts grid, with a full-width band underneath. The facts grid
// is gone (rows now — see FactsSection), and there is ONE vertical rhythm token.
const SECTION_GAP = "space-y-6";

export default function ItemView({ item, tagOverrides, tagCategories }: {
  item: PublicEnrichedItem;
  // Global tag taxonomy, read on the server (see LowerSections). Viewer-
  // independent, so it doesn't compromise the SSR guarantee described above.
  tagOverrides?: Record<string, string>;
  tagCategories?: TagDisplayCategory[];
}) {
  const [idx, setIdx] = useState(0);
  // `lg` — matches the Tailwind breakpoint the two-column layout switches at,
  // so the gallery appears exactly when its column does.
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  // The sections take an EnrichedItem. This is the ONE place that widens the
  // public type, and it's where the per-user fields are explicitly empty.
  const enriched: EnrichedItem = { ...item, platformSources: [] };

  const imgs: string[] = [];
  if (item.posterUrl) imgs.push(item.posterUrl);
  for (const u of item.images ?? []) if (u && !imgs.includes(u)) imgs.push(u);

  const dates = item.dates ?? [];
  const communityRatings = item.communityRatings ?? [];
  const hasScores = communityRatings.length > 0 || !!item.steamReviewLabel;

  const ids: Record<string, string> = {};
  for (const s of item.sources ?? []) ids[s.source] = s.sourceId;
  const steamAppId = ids.steam;

  // The hero's mono meta line — the mockup's "2026 · 2h 08m · dir. Lena Marsh".
  // Built from whatever exists; a game with no runtime just gets fewer parts.
  const year = item.releaseDate?.slice(0, 4);
  const credit = item.director ? `${item.type === "show" ? "by" : "dir."} ${item.director}` : null;
  const metaParts = [
    year ?? "TBA",
    item.runtimeMinutes ? fmtRuntime(item.runtimeMinutes) : null,
    credit,
  ].filter((p): p is string => !!p);

  // Release dates per source — shown under the title on desktop, where there's
  // room for a multi-line block the hero scrim can't hold.
  const dateBlock =
    dates.length > 0 ? (
      <div className="space-y-1">
        {dates.map((d) => (
          <div key={d.source} className="flex items-center gap-2 text-sm">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: SOURCE_COLORS[d.source] ?? "#888" }} />
            <span className="text-text-secondary text-xs w-16">{SOURCE_LABELS[d.source] ?? d.source}</span>
            <span className="font-mono text-text-primary">{fmtDate(d.date)}</span>
          </div>
        ))}
      </div>
    ) : (
      <p className="text-sm font-mono text-text-secondary">{item.releaseDate ? fmtDate(item.releaseDate) : "TBA"}</p>
    );

  // Everything below the title, identical at both breakpoints — so the two
  // layouts can't drift in content, only in how the title/art is presented.
  const belowTitle = (
    <div className={SECTION_GAP}>
      {/* Community/critic scores — public, so server-rendered. Nulled personals
          means this renders the scores row only; the per-user half lives in
          <PersonalSection> below. */}
      <RatingsSection
        hasScores={hasScores}
        communityRatings={communityRatings}
        steamReview={item.steamReviewLabel ?? null}
        personalRating={null}
        personalRatings={[]}
        libraryStatus={null}
        reviewedAt={null}
        review={null}
      />

      <PersonalSection
        itemId={item.id}
        type={item.type}
        ids={ids}
        title={item.title}
        releaseDate={item.releaseDate}
        posterUrl={item.posterUrl}
        steamStoreUrl={steamAppId ? `https://store.steampowered.com/app/${steamAppId}` : null}
      />

      {item.tagline && <p className="text-base text-text-secondary italic max-w-[68ch]">{item.tagline}</p>}
      {item.description && <p className="text-sm text-text-secondary leading-relaxed max-w-[68ch]">{item.description}</p>}

      <FactsSection enriched={enriched} type={item.type} />
    </div>
  );

  return (
    <main>
      {/* Mobile hero — full-bleed, so it sits OUTSIDE the page gutter. It carries
          its own back + share controls, which is why the BackButton below is
          desktop-only. */}
      {/* `lg:hidden` AND the isDesktop gate, and both are needed. The CSS class
          keeps the hero from flashing on a desktop first paint (the hook
          necessarily reports false until it has mounted); the gate is what
          actually stops the browser downloading 8 of its 13 images into a
          display:none subtree once we know we're on desktop. Exactly one image
          tree — this one or the gallery below — exists at any width. */}
      {!isDesktop && (
        <div className="lg:hidden">
          <DetailHero images={imgs} meta={{ type: item.type, title: item.title, metaParts }} />
        </div>
      )}

      {/* ONE content tree for both breakpoints.
          The first version of this rebuild rendered a `lg:hidden` mobile tree and
          a `hidden lg:block` desktop tree. Both are always in the DOM — CSS
          visibility is not conditional rendering — so the page mounted
          <PersonalSection> twice (two /api/detail round-trips per view) and the
          trailer <iframe> twice (two YouTube players loading, one invisible).
          Measured on Spider-Man: No Way Home: 2 iframes, 2 score panels, 2 rate
          buttons. So the layout switches with CSS, the CONTENT renders once. */}
      <div className="max-w-6xl mx-auto px-5 lg:px-6 py-5 lg:py-6">
        <BackButton fallbackHref="/discover" className="hidden lg:inline-flex mb-4" />

        <div className="lg:grid lg:grid-cols-[minmax(0,380px)_1fr] lg:gap-10 lg:items-start">
          {/* Gallery: sticky left column, DESKTOP ONLY since 2026-08-14. The
              mobile hero above is now the swipeable gallery itself (MB13), so
              rendering this under it would put the same images on the page
              twice. Desktop keeps the thumbnail-strip version: there's no swipe
              on a mouse, and the two-column layout has room for a persistent
              strip that a 3:4 phone hero doesn't.

              GATED ON useMediaQuery, NOT `hidden lg:block` — and that is
              load-bearing, not style. Measured on this very page at 375px:
              inside a `display:none` subtree the gallery still downloaded ALL
              14 of its images, on top of the hero's own. `loading="lazy"`
              doesn't save you either; Chrome fetches lazy images in a
              display:none container. This is AGENTS.md's "CSS visibility is not
              conditional rendering" invariant, in its image-bandwidth form
              rather than the double-mount form the item page hit in July.
              The hook's own doc comment names this exact case. */}
          {isDesktop && (
            <div className="lg:sticky lg:top-24 mb-6 lg:mb-0">
              <MediaGallery images={imgs} idx={Math.min(idx, Math.max(0, imgs.length - 1))} setIdx={setIdx} title={item.title} />
            </div>
          )}

          <div className={`min-w-0 ${SECTION_GAP}`}>
            {/* Desktop title block. The mobile title lives in the hero scrim, so
                two <h1>s exist in the DOM with one display:none — the same
                pattern (and the same reasoning) as AppNav's paired desktop/mobile
                <nav>s: display:none removes it from the a11y tree, so exactly one
                is ever announced. */}
            <div className="hidden lg:block space-y-2.5">
              <div className="inline-flex items-center gap-1.5">
                {/* TYPE_COLORS, not var(--color-media-*) — either works today
                    (2026-07-31: the media tokens were relocated out of @theme
                    into a plain :root block, the same fix the facet tokens got,
                    so the var() now resolves). Left on TYPE_COLORS since it was
                    already correct and there's no reason to migrate. */}
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: TYPE_COLORS[item.type] }} />
                <span className="font-mono text-eyebrow uppercase text-text-secondary">{item.type}</span>
              </div>
              <h1 className="font-serif text-serif-2xl text-text-primary leading-tight">{item.title}</h1>
              <p className="font-mono text-meta text-text-secondary">{metaParts.join(" · ")}</p>
            </div>

            {/* Per-source release dates. On mobile the hero's meta line already
                gives the year, so this is only additive when sources disagree. */}
            <div className={dates.length > 1 ? "" : "hidden lg:block"}>{dateBlock}</div>

            {belowTitle}
          </div>
        </div>

        {/* MB14 — per-episode tracking. Full width (a season list wants the room)
            and shows only; the component itself renders nothing for a title with
            no season data. Mounted ONCE, like every other island on this page. */}
        {item.type === "show" && <EpisodeTracker mediaItemId={item.id} />}

        {/* Full-width band below both columns, one rhythm with the stack above. */}
        <LowerSections enriched={enriched} type={item.type} tagOverrides={tagOverrides} tagCategories={tagCategories} />

        {/* "More like this" — the mockup's placeholder rail, built 2026-07-31.
            Mounted ONCE here (not per breakpoint — see SimilarRail's own
            comment for why that distinction matters). */}
        <div className="mt-10">
          <SimilarRail itemId={item.id} type={item.type} />
        </div>
      </div>
    </main>
  );
}
