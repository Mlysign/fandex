// The item page as an HTML string, with nothing around it: no Worker, no D1.
// check-html.mjs calls it from Node to prove the page still renders on a
// server and to count what a crawler would find in it. The daily static build
// (docs/app-plan.md, "The website") will render pages the same way.

import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import { AppRegistry } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ItemPage } from '~/components/ItemPage';
import { Screen } from '~/components/ui';
import type { ItemDetail } from '~/lib/api';
import { prepareTaxonomy, type Taxonomy, type TaxonomyJson } from '~/lib/fandexScore';

const NO_INSETS = { frame: { x: 0, y: 0, width: 0, height: 0 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

function Page({ item, taxonomy }: { item: ItemDetail; taxonomy: Taxonomy | null }) {
  return (
    <SafeAreaProvider initialMetrics={NO_INSETS}>
      <Screen headed>
        <ItemPage item={item} taxonomy={taxonomy} />
      </Screen>
    </SafeAreaProvider>
  );
}
AppRegistry.registerComponent('Item', () => Page);

export function renderItem(item: ItemDetail, taxonomyJson: TaxonomyJson | null): { body: string; css: string } {
  const taxonomy = taxonomyJson ? prepareTaxonomy(taxonomyJson) : null;
  const { element, getStyleElement } = AppRegistry.getApplication('Item', { initialProps: { item, taxonomy } });
  return { body: renderToString(element), css: renderToStaticMarkup(getStyleElement()) };
}
