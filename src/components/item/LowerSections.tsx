"use client";
import Image from "next/image";
import Link from "next/link";
import { EnrichedItem, MediaType } from "@/types";
import { SOURCE_COLORS } from "@/lib/constants";
import FacetLink, { facetHref } from "@/components/FacetLink";
import { categorizeTag, CATEGORIES } from "@/lib/tags";
import { tagKey } from "@/lib/facets";

// Q21 (2026-07-19) — one cast member, styled like a PosterCard but for a
// person (portrait photo, no release date/rating). Used in a horizontal
// scroll strip, the same pattern Insights uses for "items behind this bar"
// (InsightsView.tsx's ItemCardRow: flex/overflow-x-auto/snap-x row of
// w-28/32 shrink-0 cards).
function CastCard({ name, character, profileUrl }: { name: string; character: string | null; profileUrl?: string | null }) {
  return (
    <Link
      href={facetHref("person", "cast", name)}
      className="group block rounded-xl border border-neutral-800 bg-neutral-900 hover:border-neutral-600 transition-all overflow-hidden"
    >
      <div className="relative w-full bg-neutral-800 overflow-hidden" style={{ paddingBottom: "140%" }}>
        {profileUrl ? (
          <Image src={profileUrl} alt={name} fill sizes="140px" className="object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-2xl font-bold text-neutral-600">{name?.[0] ?? "?"}</div>
        )}
      </div>
      <div className="px-2 py-1.5 space-y-0.5">
        <p className="text-xs font-medium text-neutral-200 line-clamp-1 group-hover:text-white">{name}</p>
        {character && <p className="text-[11px] text-neutral-500 line-clamp-1">{character}</p>}
      </div>
    </Link>
  );
}

// The stacked lower-detail sections: trailer, cast, where-to-watch, DLC, the
// combined tags/keywords/modes/platforms block, and store links.
export default function LowerSections({ enriched, type }: { enriched: EnrichedItem | null; type: MediaType }) {
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
          <p className="text-xs text-neutral-500 uppercase tracking-wider mb-3">Trailer</p>
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

      {/* Cast — horizontal scroll strip (Q21: matches the Insights "items
          behind this bar" card-row pattern instead of a static photo grid) */}
      {(type === "movie" || type === "show") && cast.length > 0 && (
        <section>
          <p className="text-xs text-neutral-500 uppercase tracking-wider mb-3">Cast</p>
          <div className="flex gap-3 overflow-x-auto pb-2 -mb-2 snap-x">
            {cast.map((c, i) => (
              <div key={`${c.name}-${i}`} className="w-28 sm:w-32 shrink-0 snap-start">
                <CastCard name={c.name} character={c.character} profileUrl={c.profileUrl} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Where to watch */}
      {streamingProviders.length > 0 && (
        <section>
          <p className="text-xs text-neutral-500 uppercase tracking-wider mb-3">Where to watch</p>
          <div className="flex flex-wrap gap-2">
            {streamingProviders.map((p) => (
              <div key={p.providerId} className="flex items-center gap-1.5 bg-neutral-800 rounded-lg px-2.5 py-1.5">
                {p.logoPath && <Image src={`https://image.tmdb.org/t/p/w45${p.logoPath}`} width={20} height={20} className="w-5 h-5 rounded" alt={p.name} />}
                <span className="text-xs">{p.name}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* DLC / expansions / included content */}
      {dlc.length > 0 && (
        <section>
          <p className="text-xs text-neutral-500 uppercase tracking-wider mb-3">DLC &amp; expansions</p>
          <div className="flex flex-wrap gap-1.5">
            {dlc.map((d) => (
              <span key={d} className="text-xs px-2 py-0.5 bg-neutral-800 rounded-full text-neutral-300">{d}</span>
            ))}
          </div>
        </section>
      )}

      {/* Tags · keywords · modes · platforms — one section, grouped & color-coded by type (T13) */}
      {(() => {
        // Tags and keywords are the same thing: merge, dedupe by normalized key, categorize.
        const byCat = new Map<string, string[]>();
        const seen = new Set<string>();
        for (const t of [...tags, ...keywords]) {
          const k = tagKey(t);
          if (!k || seen.has(k)) continue;
          seen.add(k);
          const cat = categorizeTag(k);
          let arr = byCat.get(cat);
          if (!arr) { arr = []; byCat.set(cat, arr); }
          arr.push(t);
        }
        type Group = { id: string; label: string; color: string; kind: "tag" | "plain"; items: string[] };
        const groups: Group[] = [];
        for (const c of CATEGORIES) {
          const items = byCat.get(c.id);
          if (items?.length) groups.push({ id: c.id, label: c.label, color: c.color, kind: "tag", items });
        }
        if (platformList.length) groups.push({ id: "platform", label: "Platforms", color: "#9ca3af", kind: "plain", items: platformList });
        if (gameModes.length) groups.push({ id: "mode", label: "Modes & perspective", color: "#9ca3af", kind: "plain", items: gameModes });
        if (!groups.length) return null;
        return (
          <section>
            <p className="text-xs text-neutral-500 uppercase tracking-wider mb-3">Tags &amp; details</p>
            <div className="space-y-2.5">
              {groups.map((g) => (
                <div key={g.id} className="flex flex-wrap items-baseline gap-1.5">
                  <span className="text-[10px] uppercase tracking-wide text-neutral-600 mr-1 shrink-0">{g.label}</span>
                  {g.items.map((it) =>
                    g.kind === "tag" ? (
                      <FacetLink key={it} kind="tag" label={it} className="text-xs px-2 py-0.5 rounded-full transition-all hover:brightness-125" style={{ background: `${g.color}22`, color: g.color }} />
                    ) : (
                      <span key={it} className="text-xs px-2 py-0.5 rounded-full" style={{ background: `${g.color}1f`, color: g.color }}>{it}</span>
                    )
                  )}
                </div>
              ))}
            </div>
          </section>
        );
      })()}

      {/* Store links */}
      {storeLinks.length > 0 && (
        <section className="pt-2 border-t border-neutral-800">
          <p className="text-xs text-neutral-500 uppercase tracking-wider mb-3">Links</p>
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
