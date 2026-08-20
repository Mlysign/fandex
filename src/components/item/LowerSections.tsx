"use client";
import Image from "next/image";
import Link from "next/link";
import type { EnrichedItem, MediaType } from "@/types";
import FacetLink, { facetHref } from "@/components/FacetLink";
import { groupTagsByCategory, type TagDisplayCategory } from "@/lib/tags";
import { facetChipStyle, nonFacetChipStyle } from "@/lib/facetPalette";
import { tagKey } from "@/lib/facets";
import TagCategoryPicker from "@/components/TagCategoryPicker";
import StoreLink from "./StoreLink";
import { SectionHeading } from "./primitives";

// One cast member — the mockup's `.castav` (04-pages/item-detail.html:151): a
// 64px CIRCULAR portrait above the name and character, in a 74px column.
//
// 2026-07-30: was a portrait poster-style card (Q21, 2026-07-19) borrowed from
// Insights' item rows. A 2:3 rectangle reads as "a title" everywhere else in this
// app, so using it for a person made the cast strip look like a second content
// rail. A circle reads as a person at any size, which is the whole reason the
// mockup uses one.
function CastCard({ name, character, profileUrl }: { name: string; character: string | null; profileUrl?: string | null }) {
  return (
    <Link href={facetHref("person", "cast", name)} className="group block text-center">
      <div className="relative w-16 h-16 mx-auto rounded-full overflow-hidden bg-surface-elevated border border-border group-hover:border-border-strong transition-colors">
        {profileUrl ? (
          <Image src={profileUrl} alt={name} fill sizes="64px" className="object-cover" />
        ) : (
          /* H1.6f a11y: neutral-600 here was 1.48:1 on the placeholder well — see PosterCard. */
          <div className="absolute inset-0 flex items-center justify-center text-lg font-bold text-neutral-500">{name?.[0] ?? "?"}</div>
        )}
      </div>
      <p className="text-caption font-semibold text-text-primary mt-2 line-clamp-2">{name}</p>
      {character && <p className="text-[8.5px] text-text-secondary line-clamp-1">{character}</p>}
    </Link>
  );
}

// P18 — the mockup's second provider line ("Stream · included" / "Rent"). TMDB
// gives the bucket (flatrate/free/ads/rent/buy) a region's providers came
// from, not a price, so this labels the bucket rather than inventing one.
function offerTypeLabel(offerType: string | null): string | null {
  switch (offerType) {
    case "flatrate": return "Stream · included";
    case "free": return "Stream · free";
    case "ads": return "Stream · free with ads";
    case "rent": return "Rent";
    case "buy": return "Buy";
    default: return null;
  }
}

// ── Affiliate disclosure (H3.4 / §5a UWG) ────────────────────────────────────
//
// docs/monetization-legal.md's "defensible minimum" is TWO things, and both are
// implemented here: a small persistent marker on every affiliate link, plus a
// one-line page-level notice. It deliberately does not rely on §5a's
// "commercial intent directly apparent from context" carve-out — German courts
// have no settled test for when that applies, and labeling is far cheaper than
// finding out. H4.0's lawyer still confirms whether the marker alone would
// suffice; until then we ship both.
//
// Rendered inline and visible by default — never a tooltip, never a footnote.

/** The per-link marker. Small, but never hidden. */
function AffiliateMark() {
  return (
    <span
      className="font-mono text-micro uppercase tracking-wide px-1 py-px rounded border border-current opacity-70"
      /* The visual is tiny, so the accessible name carries the full word — a
         screen-reader user gets "affiliate link", not the letters "ad". */
      aria-label="affiliate link"
      title="Affiliate link. Fandex may earn a commission"
    >
      Ad
    </span>
  );
}

/** The section-level notice that accompanies any block containing affiliate links. */
function BuyDisclosure() {
  return (
    <p className="font-mono text-meta text-text-secondary mt-2">
      Links marked <span className="uppercase">Ad</span> are affiliate links. Fandex may earn a
      commission on a purchase, at no extra cost to you.
    </p>
  );
}

// The stacked lower-detail sections: trailer, cast, where-to-watch, DLC, the
// combined tags/keywords/modes/platforms block, where-to-buy, and store links.
export default function LowerSections({ enriched, type, tagOverrides = {}, tagCategories = [] }: {
  enriched: EnrichedItem | null;
  type: MediaType;
  // Global taxonomy, resolved on the SERVER and passed down: this is a client
  // component and can't read the DB, but the data is the same for every viewer,
  // so threading it as a prop keeps ItemView's "nothing above PersonalSection
  // may depend on a session" SSR guarantee intact.
  tagOverrides?: Record<string, string>;
  tagCategories?: TagDisplayCategory[];
}) {
  const trailerKey      = enriched?.trailerYoutubeKey ?? null;
  const steamTrailerUrl = enriched?.steamTrailerUrl ?? null;
  const cast            = enriched?.cast ?? [];
  const streamingProviders = enriched?.streamingProviders ?? [];
  // P18: one JustWatch link + offer type for the WHOLE picked region, shared
  // by every provider row below — not per provider (see merge.ts).
  const streamingLink      = enriched?.streamingLink ?? null;
  const streamingOfferType = enriched?.streamingOfferType ?? null;
  const streamingOfferLabel = offerTypeLabel(streamingOfferType);
  const dlc             = enriched?.dlc ?? [];
  const tags            = enriched?.tags ?? [];
  const keywords        = enriched?.keywords ?? [];
  const platformList    = enriched?.platforms ?? [];
  const gameModes       = enriched?.gameModes ?? [];
  const storeLinks      = enriched?.storeLinks ?? [];
  const buyLinks        = enriched?.buyLinks ?? [];
  // Drives the where-to-watch empty state's wording: "not out yet" and "out,
  // but nobody carries it here" are different facts and a viewer can tell them
  // apart. A missing/TBA date is treated as released — an unknown date is not
  // evidence of the future, and the softer sentence is the safe default.
  const isUnreleased = !!enriched?.releaseDate && enriched.releaseDate > new Date().toISOString().slice(0, 10);

  return (
    <div className="mt-10 space-y-8">
      {/* Trailer */}
      {trailerKey ? (
        <section>
          <SectionHeading>Trailer</SectionHeading>
          <div className="relative w-full max-w-3xl rounded-xl overflow-hidden" style={{ paddingBottom: "min(56.25%, 480px)" }}>
            <iframe
              className="absolute inset-0 w-full h-full"
              src={`https://www.youtube.com/embed/${trailerKey}?rel=0`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        </section>
      ) : steamTrailerUrl ? (
        <a href={steamTrailerUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-lg" style={{ background: "#1b9af720", color: "#1b9af7" }}>
          Watch trailer on Steam →
        </a>
      ) : null}

      {/* Cast — horizontal strip of circular portraits (the mockup's `.castav`
          row). 74px columns, matching the mockup's own width. */}
      {(type === "movie" || type === "show") && cast.length > 0 && (
        <section>
          <SectionHeading>Cast</SectionHeading>
          <div className="flex gap-3 overflow-x-auto pb-2 -mb-2 snap-x">
            {cast.map((c, i) => (
              <div key={`${c.name}-${i}`} className="w-[74px] shrink-0 snap-start">
                <CastCard name={c.name} character={c.character} profileUrl={c.profileUrl} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Where to watch — the mockup's `.prov` ROWS (logo block · name +
          availability · action), not the chip cloud this was until 2026-07-30. A
          cloud of tiny logos gave no room for the availability line the mockup
          shows and read as a tag list rather than a place to go.

          2026-08-14 (Nils, mobile testing): the whole section used to be gated
          on `streamingProviders.length > 0`, so a title with no availability
          simply had no section — indistinguishable from a title we never
          checked. It now always renders for movies and shows and says so
          explicitly. Games keep the gate: "where to watch" is not a question
          about a game, and the store rows in the Links section below are the
          equivalent affordance. */}
      {streamingProviders.length === 0 && (type === "movie" || type === "show") && (
        <section>
          <SectionHeading>Where to watch</SectionHeading>
          <p className="text-sm text-text-secondary">
            {isUnreleased
              ? "Not streaming anywhere yet. This hasn't been released."
              : "Not available on any streaming service in your region right now."}
          </p>
        </section>
      )}

      {streamingProviders.length > 0 && (
        <section>
          <SectionHeading>Where to watch</SectionHeading>
          <div>
            {streamingProviders.map((p) => {
              const rowContent = (
                <>
                  <div className="w-9 h-9 rounded-lg overflow-hidden bg-surface-elevated border border-border flex items-center justify-center shrink-0">
                    {p.logoPath
                      ? <Image src={`https://image.tmdb.org/t/p/w45${p.logoPath}`} width={36} height={36} className="w-9 h-9 object-cover" alt="" />
                      : <span className="font-mono text-micro text-text-secondary">{p.name.slice(0, 3).toUpperCase()}</span>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-body-sm font-semibold text-text-primary truncate">{p.name}</p>
                    {streamingOfferLabel && <p className="text-meta text-text-secondary">{streamingOfferLabel}</p>}
                  </div>
                </>
              );
              const rowClass = "flex items-center gap-3 py-2.5 border-t border-border";
              // streamingLink is null for a row that hasn't healed to v3 yet
              // (ensureTmdbDetail refetches it on the next detail view) — a
              // plain, non-interactive row until then, never a dead link.
              return streamingLink ? (
                <a
                  key={p.providerId}
                  href={streamingLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${rowClass} hover:bg-surface-elevated transition-colors`}
                >
                  {rowContent}
                </a>
              ) : (
                <div key={p.providerId} className={rowClass}>
                  {rowContent}
                </div>
              );
            })}
          </div>
          {/* Required attribution (2026-07-31): TMDB's watch-provider data terms
              require crediting JustWatch as the source. Scoped to
              streamingProviders.length > 0 so an item with no availability
              doesn't credit a source it never used. */}
          <p className="font-mono text-meta text-text-secondary mt-2">
            Streaming availability data by{" "}
            <a href="https://www.justwatch.com" target="_blank" rel="noopener noreferrer" className="hover:text-text-primary transition-colors underline decoration-dotted">
              JustWatch
            </a>
          </p>
        </section>
      )}

      {/* DLC / expansions / included content */}
      {dlc.length > 0 && (
        <section>
          <SectionHeading>DLC &amp; expansions</SectionHeading>
          <div className="flex flex-wrap gap-1.5">
            {dlc.map((d) => (
              <span key={d} className="text-xs px-2 py-0.5 bg-surface-elevated rounded-full text-text-secondary">{d}</span>
            ))}
          </div>
        </section>
      )}

      {/* Tags · keywords · modes · platforms — one section, grouped & color-coded by type (T13) */}
      {(() => {
        // Tags and keywords are the same thing: merge, dedupe by normalized key,
        // categorize. Grouping lives in groupTagsByCategory() so the live admin
        // override (tag_category_override) wins over categorizeTag()'s heuristic
        // — this section used to call the heuristic directly and so contradicted
        // the inline picker sitting on the very same chip.
        type TagGroup = { id: string; label: string; kind: "tag"; items: { key: string; label: string }[] };
        type PlainGroup = { id: string; label: string; kind: "plain"; items: string[] };
        const groups: (TagGroup | PlainGroup)[] = groupTagsByCategory(
          [...tags, ...keywords].map((t) => ({ key: tagKey(t), label: t })),
          tagOverrides,
          tagCategories,
        ).map((g) => ({ id: g.id, label: g.label, kind: "tag" as const, items: g.items }));
        // 2026-07-30: the group's own `color` is deliberately dropped. Chip colour
        // now comes from the facet CLASS (genre vs any other tag category — see
        // lib/facetPalette.ts), so a category created in /dev/scoring gets a
        // sensible colour without one being invented for it. Platforms/modes
        // aren't facets at all (not scored, not navigable), so they stay neutral
        // rather than claiming a fifth colour.
        if (platformList.length) groups.push({ id: "platform", label: "Platforms", kind: "plain", items: platformList });
        if (gameModes.length) groups.push({ id: "mode", label: "Modes & perspective", kind: "plain", items: gameModes });
        if (!groups.length) return null;
        return (
          <section>
            <SectionHeading>Tags &amp; details</SectionHeading>
            <div className="space-y-2.5">
              {groups.map((g) => (
                <div key={g.id} className="flex flex-wrap items-baseline gap-1.5">
                  <span className="text-[10px] uppercase tracking-wide text-text-secondary mr-1 shrink-0">{g.label}</span>
                  {g.kind === "tag"
                    ? g.items.map((it) => (
                        // T9 (2026-07-29): admin-only inline category picker, hover-revealed —
                        // same pattern as insights/FacetSection's TagCategoryHoverPanel.
                        // categoryId is now the SAME resolved value the group heading uses
                        // (override first, heuristic second), so the picker and the heading
                        // it sits under can no longer disagree — which they did until
                        // 2026-07-30, this section having called categorizeTag() directly.
                        <div key={it.key} className="relative group">
                          <div className="absolute right-full top-1/2 -translate-y-1/2 mr-2 z-30 hidden group-hover:flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                            <TagCategoryPicker
                              tagKey={it.key}
                              categoryId={g.id}
                              className="text-xs px-2 py-1 rounded-md bg-surface-elevated border border-border-strong outline-none shadow-xl whitespace-nowrap text-text-primary"
                            />
                          </div>
                          <FacetLink kind="tag" label={it.label} className="text-xs px-2 py-0.5 rounded-full transition-all hover:brightness-125" style={facetChipStyle({ kind: "tag", category: g.id })} />
                        </div>
                      ))
                    : g.items.map((it) => (
                        <span key={it} className="text-xs px-2 py-0.5 rounded-full" style={nonFacetChipStyle()}>{it}</span>
                      ))}
                </div>
              ))}
            </div>
          </section>
        );
      })()}

      {/* Where to buy — H3.4's synthesized affiliate rows. Empty (so this whole
          section is absent) unless MONETIZATION_ENABLED is on AND a program is
          configured, which is how the commercial surface stays dark until
          H4.2's Impressum ships. Every row here is an affiliate link by
          construction, so the marker is unconditional rather than per-row. */}
      {buyLinks.length > 0 && (
        <section className="pt-2 border-t border-border">
          <SectionHeading>Where to buy</SectionHeading>
          <div className="flex flex-wrap gap-2">
            {buyLinks.map((l) => (
              <a
                key={l.programId}
                href={l.url}
                target="_blank"
                /* `sponsored` is the rel Google requires on a paid link; without
                   it these read as ordinary editorial links. */
                rel="sponsored noopener noreferrer"
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-surface-elevated border border-border text-text-primary hover:border-border-strong transition-colors"
              >
                {l.label}
                {l.grayMarket && (
                  /* Not a legal requirement — an honesty one. These resell keys
                     bought elsewhere; provenance isn't guaranteed and support is
                     the buyer's problem. TASKS.md H3.4 decided them IN with that
                     risk noted, so the risk is named where it's taken. */
                  <span className="font-mono text-micro text-text-secondary">key reseller</span>
                )}
                <AffiliateMark />
              </a>
            ))}
          </div>
          <BuyDisclosure />
        </section>
      )}

      {/* Store links — brand marks, not `name →` chips (2026-08-14). See
          item/StoreLink.tsx for why the logo replaced the text pill and why the
          marks are desaturated until hover. */}
      {storeLinks.length > 0 && (
        <section className="pt-2 border-t border-border">
          <SectionHeading>Links</SectionHeading>
          <div className="flex flex-wrap gap-2">
            {storeLinks.map((l) => (
              <StoreLink key={l.name} link={l}>
                {l.affiliate && <AffiliateMark />}
              </StoreLink>
            ))}
          </div>
          {/* The section-level notice rides on the rewritten rows only — an
              un-monetized Links block must not claim a commercial relationship
              it doesn't have. */}
          {storeLinks.some((l) => l.affiliate) && <BuyDisclosure />}
        </section>
      )}
    </div>
  );
}
