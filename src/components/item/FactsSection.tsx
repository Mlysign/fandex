"use client";
import type { EnrichedItem, MediaType } from "@/types";
import FacetLink from "@/components/FacetLink";
import { Fact } from "./primitives";
import { fmtRuntime, fmtMoney, fmtDate } from "./format";

// The facts block of the item detail page: credits (director / developer /
// publisher) and everything else, as the mockup's key→value ROWS
// (04-pages/item-detail.html:152 — `Director | Lena Marsh`, `Studio | Annapurna`).
//
// 2026-07-30: was a chip cloud for credits plus a `grid-cols-2 sm:grid-cols-3`
// facts grid. Between them they were the biggest single source of the "very
// jagged" web layout — two different internal rhythms stacked inside a column
// that has its own, a ragged final grid row at most widths, and truncation with
// no tooltip. Rows scale at every breakpoint and read as one list.
//
// Credits stay FacetLinks (they're navigable facets); only the presentation
// changed.
export default function FactsSection({ enriched, type }: { enriched: EnrichedItem | null; type: MediaType }) {
  const developer      = enriched?.developer ?? null;
  const publisher      = enriched?.publisher ?? null;
  const director       = enriched?.director ?? null;
  const runtimeMinutes = enriched?.runtimeMinutes ?? null;
  const certification  = enriched?.certification ?? [];
  const status         = enriched?.status ?? null;
  const collection     = enriched?.collection ?? null;
  const originalLanguage = enriched?.originalLanguage ?? null;
  const country        = enriched?.country ?? null;
  const budget         = enriched?.budget ?? null;
  const revenue        = enriched?.revenue ?? null;
  const boxOffice      = enriched?.boxOffice ?? null;
  const awards         = enriched?.awards ?? null;
  const network        = enriched?.network ?? null;
  const seasonCount    = enriched?.seasonCount ?? null;
  const episodeCount   = enriched?.episodeCount ?? null;
  const nextEpisode    = enriched?.nextEpisode ?? null;
  const playtimeHours  = enriched?.playtimeHours ?? null;
  const timeToBeat     = enriched?.timeToBeat ?? null;

  const hasAny =
    developer || publisher || director || runtimeMinutes || certification.length || status ||
    network || seasonCount || episodeCount || collection || originalLanguage || country ||
    budget || revenue || boxOffice || playtimeHours || timeToBeat != null ||
    nextEpisode?.airDate || awards;
  if (!hasAny) return null;

  return (
    <div>
      {director && (
        <Fact label={type === "show" ? "Creator" : "Director"}>
          <FacetLink kind="person" role={type === "show" ? "creator" : "director"} label={director} className="hover:underline" />
        </Fact>
      )}
      {developer && (
        <Fact label="Developer">
          <FacetLink kind="company" role="developer" label={developer} className="hover:underline" />
        </Fact>
      )}
      {publisher && publisher !== developer && (
        <Fact label="Publisher">
          <FacetLink kind="company" role="publisher" label={publisher} className="hover:underline" />
        </Fact>
      )}
      {network && <Fact label="Network">{network}</Fact>}
      {certification.length > 0 && <Fact label="Rated">{certification.join(" · ")}</Fact>}
      {runtimeMinutes && <Fact label="Runtime">{fmtRuntime(runtimeMinutes)}{type === "show" ? "/ep" : ""}</Fact>}
      {status && <Fact label="Status">{status}</Fact>}
      {type === "show" && (seasonCount || episodeCount) && (
        <Fact label="Episodes">
          {seasonCount ? `${seasonCount} season${seasonCount > 1 ? "s" : ""}` : ""}
          {seasonCount && episodeCount ? " · " : ""}
          {episodeCount ? `${episodeCount} eps` : ""}
        </Fact>
      )}
      {nextEpisode?.airDate && (
        <Fact label="Next episode">
          {nextEpisode.season != null && nextEpisode.episode != null ? `S${nextEpisode.season}E${nextEpisode.episode} · ` : ""}
          {fmtDate(nextEpisode.airDate)}
        </Fact>
      )}
      {collection && <Fact label={type === "game" ? "Franchise" : "Collection"}>{collection}</Fact>}
      {originalLanguage && <Fact label="Language">{originalLanguage}</Fact>}
      {country && <Fact label="Country">{country}</Fact>}
      {playtimeHours && <Fact label="Avg playtime">{playtimeHours}h</Fact>}
      {timeToBeat?.normally != null && <Fact label="Time to beat">{timeToBeat.normally}h</Fact>}
      {budget && <Fact label="Budget">{fmtMoney(budget)}</Fact>}
      {(boxOffice || revenue) && <Fact label="Box office">{boxOffice ?? fmtMoney(revenue!)}</Fact>}
      {awards && (
        <Fact label="Awards" align="start">
          <span style={{ color: "var(--color-warning)" }}>{awards}</span>
        </Fact>
      )}
    </div>
  );
}
