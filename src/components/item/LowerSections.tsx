"use client";
import Image from "next/image";
import Link from "next/link";
import type { EnrichedItem, MediaType } from "@/types";
import { SOURCE_COLORS } from "@/lib/constants";
import FacetLink, { facetHref } from "@/components/FacetLink";
import { groupTagsByCategory, type TagDisplayCategory } from "@/lib/tags";
import { facetChipStyle, nonFacetChipStyle } from "@/lib/facetPalette";
import { tagKey } from "@/lib/facets";
import TagCategoryPicker from "@/components/TagCategoryPicker";
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

// The stacked lower-detail sections: trailer, cast, where-to-watch, DLC, the
// combined tags/keywords/modes/platforms block, and store links.
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
  const dlc             = enriched?.dlc ?? [];
  const tags            = enriched?.tags ?? [];
  const keywords        = enriched?.keywords ?? [];
  const platformList    = enriched?.platforms ?? [];
  const gameModes       = enriched?.gameModes ?? [];
  const storeLinks      = enriched?.storeLinks ?? [];

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
          shows and read as a tag list rather than a place to go. */}
      {streamingProviders.length > 0 && (
        <section>
          <SectionHeading>Where to watch</SectionHeading>
          <div>
            {streamingProviders.map((p) => (
              <div key={p.providerId} className="flex items-center gap-3 py-2.5 border-t border-border">
                <div className="w-9 h-9 rounded-lg overflow-hidden bg-surface-elevated border border-border flex items-center justify-center shrink-0">
                  {p.logoPath
                    ? <Image src={`https://image.tmdb.org/t/p/w45${p.logoPath}`} width={36} height={36} className="w-9 h-9 object-cover" alt="" />
                    : <span className="font-mono text-micro text-text-secondary">{p.name.slice(0, 3).toUpperCase()}</span>}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-body-sm font-semibold text-text-primary truncate">{p.name}</p>
                </div>
                {/* The mockup's second line ("Stream · included" / "Rent · from
                    $4.99") is NOT rendered, deliberately. TMDB does group
                    watch/providers by offer type, but normalize.ts collapses the
                    buckets (`flatrate ?? free ?? ads ?? rent ?? buy`) and keeps
                    only the winning list — so which bucket a provider came from
                    is not in the stored projection. Surfacing it needs a
                    normalize + re-projection pass, and inventing "Stream ·
                    included" for a rent-only provider would be worse than
                    omitting it. Logged rather than faked. */}
              </div>
            ))}
          </div>
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

      {/* Store links */}
      {storeLinks.length > 0 && (
        <section className="pt-2 border-t border-border">
          <SectionHeading>Links</SectionHeading>
          <div className="flex flex-wrap gap-2">
            {storeLinks.map((l) => (
              <a key={l.name} href={l.url} target="_blank" rel="noopener noreferrer" className="text-xs px-3 py-1.5 rounded-lg transition-colors" style={{ background: `${SOURCE_COLORS[l.source] ?? "#888"}18`, color: SOURCE_COLORS[l.source] ?? "#aaa" }}>
                {l.name} →
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
