import type { PublicEnrichedItem } from "@/lib/detail/enrich";
import { tagKey } from "@/lib/facets";
import { publicFacetHref } from "@/lib/facetUrl";
import { BASE_URL } from "@/lib/baseUrl";

// schema.org JSON-LD for the public item pages (`/{type}/{uuid}/{slug}`).
//
// The site shipped 2,022 indexable catalog pages with ZERO structured data,
// which is the standard way a movie/show/game page tells a search engine WHICH
// entity it is about rather than leaving it to guess from prose. Everything
// emitted here already exists on the enriched item the page renders — no new
// query, no provider call, no write path.
//
// ⚠️ `aggregateRating` is DELIBERATELY ABSENT, and this is the one decision in
// this file worth not reversing casually. Google's review-snippet policy is
// explicit that a rating must come from the site's own users, and every number
// Fandex could put there (TMDB, Trakt, IGDB, RAWG, Steam, IMDb) is somebody
// else's aggregate that we display under attribution. Marking those up as this
// page's own aggregate is the exact pattern that earns a structured-data manual
// action, and a manual action is a sitewide penalty rather than a lost star.
// Fandex's OWN ratings are not an alternative either — one user's score is not
// an aggregate. Revisit only when there are real per-item user ratings at
// volume, and then mark up ONLY those.

// Cap the repeated arrays. A full TMDB cast list is ~60 people and these pages
// are already ~105 KB; the first handful carry all the entity signal.
const MAX_CAST = 10;
const MAX_GENRES = 8;
const MAX_SAME_AS = 6;

// A US-style certification if we have one, else whatever came first. schema.org
// `contentRating` is a single Text, but `certification` unions every region we
// saw ("FSK 16", "PG-13", …), so picking is required rather than optional.
const US_RATING = /^(G|PG|PG-13|R|NC-17|NR|TV-(Y|Y7|G|PG|14|MA)|E|T|M|AO)$/i;

function contentRating(certification: string[]): string | undefined {
  if (!certification.length) return undefined;
  return certification.find((c) => US_RATING.test(c.trim())) ?? certification[0];
}

// Minutes → ISO 8601 duration. schema.org wants `PT136M`, not "136 min".
function isoDuration(minutes: number | null): string | undefined {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return undefined;
  return `PT${Math.round(minutes)}M`;
}

function person(name: string) {
  return { "@type": "Person", name };
}

function organization(name: string) {
  return { "@type": "Organization", name };
}

// Drop every key whose value is undefined / null / an empty array, so the
// emitted graph carries only fields we actually have. A `"director": null` is
// worse than an absent one: it asserts we know there is none.
function compact<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

// Other authoritative URLs for the SAME entity. This is what lets a crawler tie
// the page to an existing knowledge-graph node instead of treating it as a new
// one — the highest-value field on the list for a site with no authority yet.
function sameAs(item: PublicEnrichedItem): string[] {
  const urls: string[] = [];
  if (item.imdbId) urls.push(`https://www.imdb.com/title/${item.imdbId}/`);
  for (const l of item.links ?? []) {
    if (l.url && /^https?:\/\//.test(l.url)) urls.push(l.url);
  }
  return [...new Set(urls)].slice(0, MAX_SAME_AS);
}

// The shared CreativeWork half. Everything below adds to it per media type.
function common(item: PublicEnrichedItem, canonical: string) {
  return {
    name: item.title,
    url: canonical,
    image: item.posterUrl ?? item.backdropUrl ?? undefined,
    description: item.description ?? undefined,
    datePublished: item.releaseDate ?? undefined,
    genre: item.tags.slice(0, MAX_GENRES),
    inLanguage: item.originalLanguage ?? undefined,
    sameAs: sameAs(item),
  };
}

function cast(item: PublicEnrichedItem) {
  return (item.cast ?? []).slice(0, MAX_CAST).map((c) => person(c.name));
}

// Home → primary genre → this item. The middle step is honest rather than
// decorative: `/tag/{key}` genuinely lists this item, so the trail describes a
// path a visitor can walk. Falls back to a two-step trail when the item has no
// tags, which is valid but carries less.
function breadcrumb(item: PublicEnrichedItem, canonical: string) {
  const crumbs: { name: string; item: string }[] = [{ name: "Fandex", item: `${BASE_URL}/` }];

  const primaryTag = item.tags[0];
  if (primaryTag) {
    const key = tagKey(primaryTag);
    // tagKey can collapse a tag to "" (pure punctuation); an empty key has no
    // page, and publicFacetHref would emit `/tag/`.
    if (key) crumbs.push({ name: primaryTag, item: `${BASE_URL}${publicFacetHref({ kind: "tag", key })}` });
  }

  crumbs.push({ name: item.title, item: canonical });

  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: c.item,
    })),
  };
}

// The entity node itself: Movie, TVSeries or VideoGame.
export function buildEntityJsonLd(item: PublicEnrichedItem, canonical: string): Record<string, unknown> {
  const base = { "@context": "https://schema.org", ...common(item, canonical) };

  if (item.type === "game") {
    return compact({
      ...base,
      "@type": "VideoGame",
      gamePlatform: item.platforms.slice(0, MAX_GENRES),
      publisher: item.publisher ? organization(item.publisher) : undefined,
      author: item.developer ? organization(item.developer) : undefined,
      contentRating: contentRating(item.certification),
    });
  }

  if (item.type === "show") {
    return compact({
      ...base,
      "@type": "TVSeries",
      // `director` carries the show CREATOR for shows — see EnrichedItem.
      creator: item.director ? person(item.director) : undefined,
      actor: cast(item),
      numberOfSeasons: item.seasonCount ?? undefined,
      numberOfEpisodes: item.episodeCount ?? undefined,
      // Per-episode runtime for a series, which is what `timeRequired` means.
      timeRequired: isoDuration(item.runtimeMinutes),
      productionCompany: item.network ? organization(item.network) : undefined,
      contentRating: contentRating(item.certification),
      countryOfOrigin: item.country ? { "@type": "Country", name: item.country } : undefined,
    });
  }

  return compact({
    ...base,
    "@type": "Movie",
    director: item.director ? person(item.director) : undefined,
    actor: cast(item),
    duration: isoDuration(item.runtimeMinutes),
    productionCompany: item.publisher ? organization(item.publisher) : undefined,
    contentRating: contentRating(item.certification),
    countryOfOrigin: item.country ? { "@type": "Country", name: item.country } : undefined,
  });
}

export function buildItemJsonLd(item: PublicEnrichedItem, canonical: string): Record<string, unknown>[] {
  return [buildEntityJsonLd(item, canonical), breadcrumb(item, canonical)];
}

// Serialize for `<script type="application/ld+json">`.
//
// The escape is not optional. Inside a <script> the HTML parser looks for the
// literal `</script` before any JSON parsing happens, so a title or description
// containing one would close the tag early and drop the rest of the page's
// markup into the document — and every string in here is provider-supplied.
// `<` is valid JSON and parses back to `<`, so the graph is unchanged.
export function jsonLdScript(graph: Record<string, unknown>[]): string {
  return JSON.stringify(graph.length === 1 ? graph[0] : graph).replace(/</g, "\\u003c");
}
