import { cache } from "react";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { BASE_URL } from "@/lib/baseUrl";
import { isPublicType, isUuid, PUBLIC_ITEMS_INDEXABLE } from "@/lib/publicUrl";
import type { ResolvedPublic } from "@/lib/detail/publicDetail";
import { resolvePublicDetail, resolvePublicDetailBySlug } from "@/lib/detail/publicDetail";
import { getSession } from "@/lib/session";
import { getUserCountry } from "@/lib/userCountry";
import { DEFAULT_COUNTRY } from "@/lib/countries";
import ItemView from "@/components/item/ItemView";
import { getTagCategories, getTagCategoryOverrides } from "@/lib/scoringConfig";
import { getTagAliases } from "@/lib/tagAlias";
import { getFacetLabelOverrides } from "@/lib/facetLabel";
import { buildItemJsonLd, jsonLdScript } from "@/lib/jsonLd";
import { buildLocalRails } from "@/lib/detail/relatedRails";
import { log, errorFields } from "@/lib/logger";

// P13 — THE item page. `/{type}/{slug}` since 2026-08-21; `/{type}/{uuid}/{slug}`
// before that, and that shape still resolves (see [legacy]/page.tsx) so every
// link ever shared keeps working.
//
// The server renders the CATALOG half only — no user data — so crawlers and
// link unfurlers (which do not run our JS) get the real content on first byte,
// and the HTML never varies per viewer. The per-user half (rating, wishlist) is
// a client island inside ItemView that checks the session itself.
//
// WHY THE ADDRESS MOVED OFF THE UUID: the uuid is a ROW id, and the boot prune
// deletes browsed-only rows on every deploy — so re-opening such a title minted
// a new row, a new uuid and a new url, leaving the old one a hard 404. A stored,
// title-derived slug survives that, because it names the work rather than our
// storage. Full reasoning in publicUrl.ts.

interface Params {
  type: string;
  slug: string;
}

// The session is read for ONE thing: the region of the viewer, which localizes
// release dates + streaming (T22). It never changes WHICH item is rendered or
// whether it renders, so the cached HTML stays viewer-independent.
async function viewerRegion(): Promise<string> {
  try {
    const session = await getSession();
    return session ? getUserCountry(session.userId) : DEFAULT_COUNTRY;
  } catch {
    return DEFAULT_COUNTRY;
  }
}

// cache() dedupes across generateMetadata + the render, which both need the
// item. The pipeline does live provider calls, so without this every request
// would run the whole thing twice.
//
// The address segment is normally a slug. A UUID is still accepted because
// `/{type}/{uuid}` was a reachable url before this change, and because
// publicItemHref falls back to the uuid form for any payload not yet carrying a
// slug. Both redirect below rather than render, so a uuid never has a page of
// its own to compete for indexing.
const resolve = cache(async (type: string, address: string): Promise<ResolvedPublic | null> => {
  if (!isPublicType(type)) return null;
  const region = await viewerRegion();
  const found = isUuid(address)
    ? await resolvePublicDetail(address, type, region)
    : await resolvePublicDetailBySlug(type, address, region);
  if (!found || found.item.type !== type) return null;
  return found;
});

/** The one canonical url for a resolved item. */
function canonicalFor(type: string, found: ResolvedPublic): string {
  // A row predating migration 19 (or one created by some path that skipped
  // ensureItemSlug) has no address of its own. Its legacy url IS its canonical,
  // because that is the url that works — better than inventing a slug here that
  // nothing would resolve.
  return found.slug
    ? `${BASE_URL}/${type}/${found.slug}`
    : `${BASE_URL}/${type}/${found.canonicalId}`;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { type, slug } = await params;
  const found = await resolve(type, slug);
  if (!found) return { title: "Not found", robots: { index: false, follow: false } };
  const item = found.item;

  const year = item.releaseDate ? item.releaseDate.slice(0, 4) : null;
  const title = year ? `${item.title} (${year})` : item.title;
  const description =
    item.description?.slice(0, 200) ??
    `${item.title}. Release date, ratings and where to watch, on Fandex.`;
  const image = item.posterUrl ?? item.backdropUrl;
  const canonical = canonicalFor(type, found);

  return {
    title,
    description,
    ...(PUBLIC_ITEMS_INDEXABLE ? {} : { robots: { index: false, follow: false } }),
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      type: "website",
      images: image ? [{ url: image, alt: item.title }] : undefined,
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title,
      description,
      images: image ? [image] : undefined,
    },
  };
}

export default async function ItemPage({ params }: { params: Promise<Params> }) {
  const { type, slug } = await params;
  const found = await resolve(type, slug);
  if (!found) notFound();

  // A uuid in the address segment is a legacy or fallback link: send it to the
  // real address. Permanent (308), because the mapping is stable — a 307 would
  // tell Google to keep both urls in the index.
  if (isUuid(slug) && found.slug) permanentRedirect(`/${type}/${found.slug}`);

  // The tag taxonomy is global, not per-viewer, so reading it here keeps the
  // "server HTML never varies per viewer" guarantee while letting the client
  // LowerSections group chips by the live admin override instead of the code
  // heuristic. Both reads are cached + signature-invalidated in scoringConfig,
  // and tag_category_override is a handful of rows.
  const tagOverrides = Object.fromEntries(getTagCategoryOverrides());
  const tagCategories = getTagCategories().map((c) => ({ id: c.id, label: c.label, color: c.color }));
  // 2026-09-03 — tag bundling and chosen display names, read here for the same
  // reason as the two above: LowerSections is a CLIENT component, so it cannot
  // import tagAlias.ts or facetLabel.ts (both reach db.ts, and that module graph
  // is a 500 with tsc, lint and every test green). Both maps are global
  // editorial state, so passing them as props keeps the HTML viewer-independent.
  //
  // ⚠️ This surface is why the fix needed three call sites rather than one. The
  // item page renders the merged tag STRINGS, which never went through an alias
  // layer at all, so a bundled member kept showing its own spelling on the
  // most-read page in the app.
  const tagAliases = Object.fromEntries(getTagAliases());
  const tagLabels = Object.fromEntries(
    [...getFacetLabelOverrides()].flatMap(([k, v]) => (k.startsWith("tag|") ? [[k.slice(4), v]] : [])),
  );

  // Both related rails, server-rendered (2026-08-23). This is what stops the
  // item page being a crawl dead-end: before it, `/movie/dune-part-two` emitted
  // 39 internal links — 14 tags, 9 people, navigation — and NOT ONE sibling
  // title, because the rails only ever existed after a client `useEffect`.
  //
  // Two properties keep it inside this page's rules. `profile` is null, so no
  // Fandex Score and no user state are computed and the HTML stays
  // viewer-independent exactly as the comment at the top of this file promises.
  // And `buildLocalRails` makes ZERO provider calls — the MB11 provider top-up
  // deliberately stays on the client fetch, because this is the most-crawled
  // page type in the catalog and a quota-priced call here is the single most
  // expensive thing we could add (docs/scalability.md §4.2).
  //
  // Failure is non-fatal on purpose: a broken rail must not 500 the item page.
  let relatedRails;
  try {
    relatedRails = buildLocalRails(found.item.id, found.item.type, null);
  } catch (e) {
    log.warn("related_rails_ssr_failed", { itemId: found.item.id, ...errorFields(e) });
  }

  // schema.org markup. Emitted server-side beside the content it describes, so
  // a crawler gets it on first byte like the rest of this page — and built from
  // the SAME resolved item, so it can never describe a different render.
  const canonical = canonicalFor(type, found);

  return (
    <div className="min-h-screen bg-surface text-text-primary">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(buildItemJsonLd(found.item, canonical)) }}
      />
      <ItemView item={found.item} tagOverrides={tagOverrides} tagCategories={tagCategories} tagAliases={tagAliases} tagLabels={tagLabels} relatedRails={relatedRails} />
    </div>
  );
}
