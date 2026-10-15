// What the website's build renders with React, bundled for Node by build.mjs.
//
// The item page here is the app's own component (src/components/ItemPage.tsx),
// rendered to a string. That is the plan's one-component rule: there is no
// second template for the public page, so it cannot drift from the app's.
//
// Also exported: what goes in an item page's <head>, and the legal documents,
// which the build writes as plain HTML. Both come from the site's own modules
// (src/lib/jsonLd.ts, src/lib/legal), imported through "@/".

import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import { AppRegistry, Pressable, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ArrowLeft, Bookmark, Star } from 'lucide-react-native';
import { AppNav } from '~/components/AppNav';
import { StaticGrid, StaticRail, STATIC_GRID_CSS } from '~/components/cardFace';
import { backButtonStyle, FacetHeader, facetEyebrow, type FacetKind } from '~/components/FacetHeader';
import { FandexScorePanel } from '~/components/FandexScorePanel';
import { ItemPage } from '~/components/ItemPage';
import { Button } from '~/components/kit';
import { ITEM_PAGE_CSS } from '~/components/itemLayout';
import { LegalLinks } from '~/components/LegalLinks';
import { Screen } from '~/components/ui';
import type { ItemDetail, ItemVector } from '~/lib/api';
import type { CardItem } from '~/lib/cards';
import { spokenKey } from '~/lib/facetImpact';
import { prepareTaxonomy, resolveFacets, type ScoreFacet, type Taxonomy, type TaxonomyJson } from '~/lib/fandexScore';
import { indexFacets, pickRelated } from '~/lib/related';
import { byPopularity } from '~/lib/sortCards';
import { type } from '~/theme';
import { personKey } from '@/lib/facets';
import { keyToSlug } from '@/lib/facetUrl';
import { buildEntityJsonLd, jsonLdScript } from '@/lib/jsonLd';
import { everyLegalRoute, getLegalDocument } from '@/lib/legal/registry';

export const SITE = 'https://fandex.org';
/** The item page's wide layout, and the static grid's columns, for a static page's <head>. */
export { ITEM_PAGE_CSS, STATIC_GRID_CSS };

// A server has no screen to measure, so the provider is told its answer.
const NO_INSETS = { frame: { x: 0, y: 0, width: 0, height: 0 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

/** The app's own frame (src/app/(tabs)/_layout.tsx). A server cannot know the
 * window's width, so both bars are here and the page's CSS shows one. */
function Frame({ path, children }: { path: string; children: ReactNode }) {
  return (
    <SafeAreaProvider initialMetrics={NO_INSETS}>
      <View style={{ flex: 1, backgroundColor: '#100E0C' }}>
        <View {...({ dataSet: { nav: 'top' } } as object)}><AppNav variant="top" pathname={path} /></View>
        <View style={{ flex: 1 }}>{children}</View>
        <View {...({ dataSet: { nav: 'bottom' } } as object)}><AppNav variant="bottom" pathname={path} /></View>
      </View>
    </SafeAreaProvider>
  );
}

export interface StaticRails { franchise: { label: string; items: CardItem[] } | null; similar: CardItem[] }

function Page({ item, taxonomy, rails }: { item: ItemDetail; taxonomy: Taxonomy | null; rails: StaticRails | null }) {
  const path = `/${item.type}/${item.slug}`;
  return (
    <Frame path={path}>
          <Screen headed wide>
            {/* No handlers: nothing runs on a static page. The back button is a link home. */}
            <ItemPage
              item={item} taxonomy={taxonomy} backHref="/" footer={<LegalLinks />}
              // The app's two rails, picked by the build from the whole pool with the
              // app's own ranker (lib/related.ts). They are the page's links to other
              // titles: what a crawler follows, and the one lever on crawl priority
              // that is ours (docs/seo.md).
              related={rails && (rails.franchise?.items.length || rails.similar.length) ? (
                <>
                  {rails.franchise?.items.length ? <StaticRail title={`More from ${rails.franchise.label}`} items={rails.franchise.items} /> : null}
                  {rails.similar.length ? <StaticRail title="More like this" items={rails.similar} /> : null}
                </>
              ) : undefined}
              // What a visitor can do, as links: the score panel and the two
              // buttons the app shows somebody signed out. Without them the
              // page offered nothing to do, and it is the page a search engine
              // sends people to (SM57). For somebody signed in the app takes
              // the page over and draws their own.
              personal={(
                <>
                  <FandexScorePanel state="anon" fandex={null} categoryLabel={() => null} signInHref={`/profile?return=${encodeURIComponent(path)}`} />
                  {/* The app's signed-out pair. ?return= brings the visitor back here once signed in (lib/returnTo.ts). */}
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Button label="Sign in to rate" variant="secondary" size="md" href={`/profile?return=${encodeURIComponent(path)}`} icon={<Star size={14} color="#EDE7DC" />} style={{ flex: 1 }} />
                    <Button label="Save" variant="secondary" size="md" href={`/profile?return=${encodeURIComponent(path)}`} icon={<Bookmark size={14} color="#EDE7DC" />} />
                  </View>
                </>
              )}
            />
          </Screen>
    </Frame>
  );
}
AppRegistry.registerComponent('Item', () => Page);

// ── Tag, person and studio pages ─────────────────────────────────────────────

export interface FacetPageData {
  kind: FacetKind;
  /** The catalog's key, spoken: "christopher nolan". */
  key: string;
  slug: string;
  label: string;
  roles: string[];
  /** Every title carrying it, most popular first. The page shows the first FACET_CARD_CAP. */
  cards: CardItem[];
}

/**
 * Cards a static facet page shows. The old site's server-rendered facet pages
 * carried 35 to 40 titles; drawing all of them made "Action" a 10 MB page. The
 * numbers above the grid still count every title, and the app, for somebody
 * signed in, shows the whole list.
 */
export const FACET_CARD_CAP = 36;

const backLink = (
  <Pressable {...({ href: '/' } as object)} accessibilityRole="link" accessibilityLabel="Fandex, home" style={backButtonStyle}>
    <ArrowLeft size={16} color="#9A8F80" />
  </Pressable>
);

/** The app's FacetScreen as a visitor sees it, from the pool: the same header and the same cards. */
function FacetPage({ facet }: { facet: FacetPageData }) {
  const crowd = facet.cards.filter((c) => c.communityScore != null).map((c) => c.communityScore as number);
  const tiles = [
    { label: 'titles', value: String(facet.cards.length) },
    { label: 'crowd average', value: crowd.length ? (crowd.reduce((a, b) => a + b, 0) / crowd.length / 10).toFixed(1) : '-' },
  ];
  return (
    <Frame path={`/${facet.kind}/${facet.slug}`}>
      <Screen wide>
        <StaticGrid
          items={facet.cards.slice(0, FACET_CARD_CAP)}
          header={(
            <FacetHeader back={backLink} eyebrow={facetEyebrow(facet.kind, facet.roles)} name={facet.label}
              tiles={tiles} count={`titles · ${facet.cards.length}`} />
          )}
          footer={(
            <View style={{ marginTop: 24 }}>
              {facet.cards.length > FACET_CARD_CAP ? (
                <Text style={[type.bodySm, { marginBottom: 8 }]}>
                  The {FACET_CARD_CAP} most popular of {facet.cards.length}. Sign in to see every one.
                </Text>
              ) : null}
              <LegalLinks />
            </View>
          )}
        />
      </Screen>
    </Frame>
  );
}
AppRegistry.registerComponent('Facet', () => FacetPage);

export function renderFacet(facet: FacetPageData): { body: string; css: string } {
  const { element, getStyleElement } = webRegistry.getApplication('Facet', { initialProps: { facet } });
  return { body: renderToString(element), css: renderToStaticMarkup(getStyleElement()) };
}

/** The old site's metadata for a facet page (src/components/facet/facetSsr.tsx), word for word. */
export function facetHead(facet: FacetPageData): { title: string; description: string; canonical: string } {
  const label = facet.label;
  const description =
    facet.kind === 'person' ? `Every movie and show ${label} worked on, with ratings and where to watch.`
    : facet.kind === 'studio' ? `Movies, shows and games from ${label}, ranked by rating.`
    : `The best ${label} movies, shows and games, ranked by rating.`;
  return { title: label, description, canonical: `${SITE}/${facet.kind}/${facet.slug}` };
}

/** A pool title as the delta sends it: its vector and its stored facets. */
export interface PoolTitle { vector: ItemVector; facets: ScoreFacet[] }

const cardOf = (v: ItemVector): CardItem => ({
  key: v.id, id: v.id, type: v.type, title: v.title, slug: v.slug, releaseDate: v.releaseDate,
  posterUrl: v.posterUrl, communityScore: v.communityScore, communityVotes: v.communityVotes,
});
const PAGE_KIND: Record<string, FacetKind> = { tag: 'tag', person: 'person', company: 'studio' };
/** An address the build may write a file for. A tag key can keep punctuation; those stay app-only. */
const SAFE_SLUG = /^[a-z0-9][a-z0-9-]{0,120}$/;

/**
 * Every tag, person and studio carried by at least `min` pool titles, grouped
 * the way the app's FacetScreen matches them: the stored key, spoken, with a
 * company shown as a studio. Fewer than three titles is the old site's thin
 * page, which it marked noindex; here it gets no static page at all and its
 * address loads the app, as it did before.
 */
export function facetPages(pool: PoolTitle[], min = 3): FacetPageData[] {
  const groups = new Map<string, { kind: FacetKind; key: string; label: string; roles: Map<string, number>; ids: Set<string> }>();
  for (const { vector, facets } of pool) {
    for (const f of facets) {
      const kind = PAGE_KIND[f.kind];
      if (!kind || !f.key) continue;
      const key = spokenKey(f.key);
      const id = `${kind}:${key}`;
      let g = groups.get(id);
      if (!g) groups.set(id, g = { kind, key, label: f.label || key, roles: new Map(), ids: new Set() });
      g.ids.add(vector.id);
      const role = (f as { role?: string }).role;
      if (role) g.roles.set(role, (g.roles.get(role) ?? 0) + 1);
    }
  }
  const byId = new Map(pool.map((p) => [p.vector.id, p.vector]));
  const out: FacetPageData[] = [];
  for (const g of groups.values()) {
    if (g.ids.size < min) continue;
    const slug = keyToSlug(g.key);
    if (!SAFE_SLUG.test(slug)) continue;
    const cards = [...g.ids].map((i) => byId.get(i)!).filter((v) => v.slug).map(cardOf);
    if (cards.length < min) continue;
    out.push({
      kind: g.kind, key: g.key, slug, label: g.label,
      roles: [...g.roles.entries()].sort((a, b) => b[1] - a[1]).map(([r]) => r),
      cards: byPopularity(cards, (c) => ({ type: c.type, score: c.communityScore, votes: c.communityVotes ?? 0 }), true),
    });
  }
  return out;
}

/** For the item page's breadcrumb: given a title's facets, its first tag that has a static page. */
export function tagCrumbs(pages: FacetPageData[]): (facets: ScoreFacet[]) => { name: string; url: string } | null {
  const bySlug = new Map(pages.filter((p) => p.kind === 'tag').map((p) => [p.slug, p]));
  return (facets) => {
    for (const f of facets) {
      if (f.kind !== 'tag' || !f.key) continue;
      const page = bySlug.get(keyToSlug(spokenKey(f.key)));
      if (page) return { name: page.label, url: `${SITE}/tag/${page.slug}` };
    }
    return null;
  };
}

// ── Popular people ───────────────────────────────────────────────────────────

/** The old site's role weights (src/lib/discovery.ts, ROLE_WEIGHT). */
const PERSON_ROLE_WEIGHT: Record<string, number> = { director: 1.3, creator: 1.3, writer: 1.0, cast: 0.6 };
/** The old site's index threshold: a person on fewer titles has no static page to link to. */
const PEOPLE_MIN_TITLES = 3;
/** Ranked this deep; the app rotates a shorter rail out of it. */
const PEOPLE_POOL = 60;

export interface PopularPersonOut {
  key: string; name: string; href: string; portraitUrl: string | null; titleCount: number; topRole: string; score: number;
}

/**
 * Home's "Popular people", as the old site ranked it (src/lib/popularPeople.ts):
 * the sum over pool titles of the role's weight times a gentle recency factor,
 * three titles or more. The portraits come from the titles' cast lists, which
 * the build already holds, so neither the build nor the app asks TMDB per face.
 */
export function popularPeople(pool: PoolTitle[], details: Iterable<ItemDetail>, now = new Date()): PopularPersonOut[] {
  const thisYear = now.getUTCFullYear();
  const recency = (date: string | null) => {
    const age = thisYear - Number(date?.slice(0, 4));
    if (!Number.isFinite(age)) return 1;
    return age <= 1 ? 1.6 : age <= 3 ? 1.35 : age <= 8 ? 1.15 : age <= 20 ? 1 : 0.85;
  };
  const acc = new Map<string, { name: string; score: number; items: Set<string>; roles: Map<string, number> }>();
  for (const { vector, facets } of pool) {
    const boost = recency(vector.releaseDate);
    for (const f of facets as (ScoreFacet & { role?: string; prominence?: number })[]) {
      if (f.kind !== 'person' || !f.role || !f.key) continue;
      const weight = (PERSON_ROLE_WEIGHT[f.role] ?? 1) * (f.prominence ?? 1);
      const cur = acc.get(f.key) ?? { name: f.label || f.key, score: 0, items: new Set<string>(), roles: new Map<string, number>() };
      cur.score += weight * boost;
      cur.items.add(vector.id);
      cur.roles.set(f.role, (cur.roles.get(f.role) ?? 0) + weight);
      if (f.label && f.label.length > cur.name.length) cur.name = f.label;
      acc.set(f.key, cur);
    }
  }
  const portraits = new Map<string, string>();
  for (const item of details) {
    for (const c of item.merged.cast ?? []) {
      if (c.profileUrl && !portraits.has(personKey(c.name))) portraits.set(personKey(c.name), c.profileUrl);
    }
  }
  const out: PopularPersonOut[] = [];
  for (const [key, a] of acc) {
    if (a.items.size < PEOPLE_MIN_TITLES) continue;
    const slug = keyToSlug(key);
    if (!SAFE_SLUG.test(slug)) continue;
    const topRole = [...a.roles.entries()].sort((x, y) => y[1] - x[1])[0][0];
    out.push({ key, name: a.name, href: `/person/${slug}`, portraitUrl: portraits.get(key) ?? null, titleCount: a.items.size, topRole, score: a.score });
  }
  return out.sort((x, y) => y.score - x.score).slice(0, PEOPLE_POOL);
}

/** Both rails for every pool title, picked as the app picks them (lib/related.ts). Build once, ask per title. */
export function relatedPicker(pool: PoolTitle[], taxonomyJson: TaxonomyJson): (id: string, rawFacets: ScoreFacet[]) => StaticRails {
  const tax = prepareTaxonomy(taxonomyJson);
  const index = indexFacets(pool.map((p) => ({ id: p.vector.id, facets: p.facets })), tax);
  const vectors = new Map(pool.map((p) => [p.vector.id, p.vector]));
  return (id, rawFacets) => {
    const picked = pickRelated({ id, facets: resolveFacets(rawFacets, id, tax), index, vectors });
    const cards = (ids: string[]) => ids.map((i) => vectors.get(i)).filter((v): v is ItemVector => !!v && !!v.slug).map(cardOf);
    return {
      franchise: picked.franchise ? { label: picked.franchise.label, items: cards(picked.franchise.ids) } : null,
      similar: cards(picked.similar),
    };
  };
}

// `getApplication` is react-native-web's server-rendering entry. React Native's
// own types, which are the ones this package compiles against, do not have it.
const webRegistry = AppRegistry as unknown as {
  getApplication(key: string, params: { initialProps: object }): { element: ReactElement; getStyleElement(): ReactElement };
};

let prepared: { json: TaxonomyJson; taxonomy: Taxonomy } | null = null;

export function renderItem(item: ItemDetail, taxonomyJson: TaxonomyJson | null, rails: StaticRails | null = null): { body: string; css: string } {
  // The taxonomy is the same object for every page of a build. Prepare it once.
  if (taxonomyJson && prepared?.json !== taxonomyJson) prepared = { json: taxonomyJson, taxonomy: prepareTaxonomy(taxonomyJson) };
  const taxonomy = taxonomyJson ? prepared!.taxonomy : null;
  const { element, getStyleElement } = webRegistry.getApplication('Item', { initialProps: { item, taxonomy, rails } });
  return { body: renderToString(element), css: renderToStaticMarkup(getStyleElement()) };
}

export interface ItemHead {
  title: string;
  description: string;
  canonical: string;
  image: string | null;
  /** Ready for a <script type="application/ld+json">: already escaped. */
  jsonLd: string;
}

/** The old site's metadata for an item page (src/app/[type]/[slug]/page.tsx), word for word. */
export function itemHead(item: ItemDetail, tagCrumb: { name: string; url: string } | null = null): ItemHead {
  const m = item.merged;
  const canonical = `${SITE}/${item.type}/${item.slug}`;
  const year = m.releaseDate ? m.releaseDate.slice(0, 4) : null;
  const image = m.posterUrl ?? m.backdropUrl ?? null;
  // No aggregateRating, on purpose: see the note in src/lib/jsonLd.ts.
  const entity = buildEntityJsonLd({ ...m, type: item.type } as never, canonical);
  // The old site's three steps: the middle one is the title's first tag. Only
  // when that tag has a static page, because a crumb must lead somewhere.
  const steps = [{ name: 'Fandex', item: `${SITE}/` }, ...(tagCrumb ? [{ name: tagCrumb.name, item: tagCrumb.url }] : []), { name: m.title, item: canonical }];
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: steps.map((s, i) => ({ '@type': 'ListItem', position: i + 1, ...s })),
  };
  return {
    title: year ? `${m.title} (${year})` : m.title,
    description: m.description?.slice(0, 200) ?? `${m.title}. Release date, ratings and where to watch, on Fandex.`,
    canonical,
    image,
    jsonLd: jsonLdScript([entity, breadcrumb]),
  };
}

export function legalDocuments() {
  return everyLegalRoute().map(({ locale, doc }) => ({ locale, doc, content: getLegalDocument(locale, doc) }));
}
