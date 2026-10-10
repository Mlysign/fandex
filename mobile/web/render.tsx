// What the website's build renders with React, bundled for Node by build.mjs.
//
// The item page here is the app's own component (src/components/ItemPage.tsx),
// rendered to a string. That is the plan's one-component rule: there is no
// second template for the public page, so it cannot drift from the app's.
//
// Also exported: what goes in an item page's <head>, and the legal documents,
// which the build writes as plain HTML. Both come from the site's own modules
// (src/lib/jsonLd.ts, src/lib/legal), imported through "@/".

import type { ReactElement } from 'react';
import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import { AppRegistry, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppNav } from '~/components/AppNav';
import { ItemPage } from '~/components/ItemPage';
import { LegalLinks } from '~/components/LegalLinks';
import { Screen } from '~/components/ui';
import type { ItemDetail } from '~/lib/api';
import { prepareTaxonomy, type Taxonomy, type TaxonomyJson } from '~/lib/fandexScore';
import { buildEntityJsonLd, jsonLdScript } from '@/lib/jsonLd';
import { everyLegalRoute, getLegalDocument } from '@/lib/legal/registry';

export const SITE = 'https://fandex.org';

// A server has no screen to measure, so the provider is told its answer.
const NO_INSETS = { frame: { x: 0, y: 0, width: 0, height: 0 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

function Page({ item, taxonomy }: { item: ItemDetail; taxonomy: Taxonomy | null }) {
  const path = `/${item.type}/${item.slug}`;
  return (
    <SafeAreaProvider initialMetrics={NO_INSETS}>
      {/* The app's own frame (src/app/(tabs)/_layout.tsx). A server cannot know the
          window's width, so both bars are here and the page's CSS shows one. */}
      <View style={{ flex: 1, backgroundColor: '#100E0C' }}>
        <View {...({ 'data-nav': 'top' } as object)}><AppNav variant="top" pathname={path} /></View>
        <View style={{ flex: 1 }}>
          <Screen headed>
            {/* No handlers: nothing runs on a static page. The back button is a link home. */}
            <ItemPage item={item} taxonomy={taxonomy} backHref="/" footer={<LegalLinks />} />
          </Screen>
        </View>
        <View {...({ 'data-nav': 'bottom' } as object)}><AppNav variant="bottom" pathname={path} /></View>
      </View>
    </SafeAreaProvider>
  );
}
AppRegistry.registerComponent('Item', () => Page);

// `getApplication` is react-native-web's server-rendering entry. React Native's
// own types, which are the ones this package compiles against, do not have it.
const webRegistry = AppRegistry as unknown as {
  getApplication(key: string, params: { initialProps: object }): { element: ReactElement; getStyleElement(): ReactElement };
};

let prepared: { json: TaxonomyJson; taxonomy: Taxonomy } | null = null;

export function renderItem(item: ItemDetail, taxonomyJson: TaxonomyJson | null): { body: string; css: string } {
  // The taxonomy is the same object for every page of a build. Prepare it once.
  if (taxonomyJson && prepared?.json !== taxonomyJson) prepared = { json: taxonomyJson, taxonomy: prepareTaxonomy(taxonomyJson) };
  const taxonomy = taxonomyJson ? prepared!.taxonomy : null;
  const { element, getStyleElement } = webRegistry.getApplication('Item', { initialProps: { item, taxonomy } });
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
export function itemHead(item: ItemDetail): ItemHead {
  const m = item.merged;
  const canonical = `${SITE}/${item.type}/${item.slug}`;
  const year = m.releaseDate ? m.releaseDate.slice(0, 4) : null;
  const image = m.posterUrl ?? m.backdropUrl ?? null;
  // No aggregateRating, on purpose: see the note in src/lib/jsonLd.ts.
  const entity = buildEntityJsonLd({ ...m, type: item.type } as never, canonical);
  // Two steps where the old site had three. The middle one was the title's
  // first tag, and tag pages do not exist here yet; a crumb must lead somewhere.
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Fandex', item: `${SITE}/` },
      { '@type': 'ListItem', position: 2, name: m.title, item: canonical },
    ],
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
