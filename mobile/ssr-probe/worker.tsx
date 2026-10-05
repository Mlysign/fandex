// The phase 3 measurement (docs/app-plan.md, "The website"): what does it cost
// a free Worker to render the app's real item page to HTML?
//
// A throwaway Worker, deployed for the measurement and deleted after it. It
// reads one item from D1 the way a public page would, renders the SAME
// component the app's item screen uses, and returns the page. CPU time is read
// from outside with `wrangler tail`: a Worker cannot time itself, its clock
// only moves across I/O.
//
//   /item/{id}   the D1 read, the parse, and the React render
//   /read/{id}   the D1 read and the parse only: the control the render is priced against
//   /heaviest    the ids of the twenty largest docs per media type

import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import { AppRegistry } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ItemPage } from '~/components/ItemPage';
import { Screen } from '~/components/ui';
import type { ItemDetail } from '~/lib/api';

interface Env {
  DB: { prepare(sql: string): { bind(...v: unknown[]): { first<T>(): Promise<T | null>; all<T>(): Promise<{ results: T[] }> } } };
}

// A server has no screen to measure, so the provider is told its answer, the
// way the app's root layout would be on a static render.
const NO_INSETS = { frame: { x: 0, y: 0, width: 0, height: 0 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

function Page({ item }: { item: ItemDetail }) {
  return (
    <SafeAreaProvider initialMetrics={NO_INSETS}>
      <Screen headed>
        <ItemPage item={item} />
      </Screen>
    </SafeAreaProvider>
  );
}
AppRegistry.registerComponent('Item', () => Page);

interface Row { id: string; type: string; slug: string | null; browsed: number; updated_at: number; vector: string; merged: string }

async function load(env: Env, id: string): Promise<ItemDetail | null> {
  const row = await env.DB.prepare(
    `SELECT mi.id, mi.type, mi.slug, mi.browsed, mi.updated_at, d.vector, d.merged
       FROM media_items mi JOIN item_doc d ON d.media_item_id = mi.id WHERE mi.id = ?`,
  ).bind(id).first<Row>();
  if (!row) return null;
  // The public page reads no facets: they feed the personal score, which a
  // crawler never sees. One parse fewer than the API's item route would need.
  return {
    id: row.id, type: row.type, slug: row.slug, inPool: row.browsed === 0, updatedAt: row.updated_at, region: 'US',
    vector: JSON.parse(row.vector), facets: [], merged: JSON.parse(row.merged),
  } as unknown as ItemDetail;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const [, mode, id] = new URL(request.url).pathname.split('/');

    if (mode === 'heaviest') {
      const out: Record<string, unknown> = {};
      for (const type of ['movie', 'show', 'game']) {
        out[type] = (await env.DB.prepare(
          `SELECT mi.id, mi.title, LENGTH(d.merged) bytes FROM media_items mi JOIN item_doc d ON d.media_item_id = mi.id
            WHERE mi.browsed = 0 AND mi.type = ? ORDER BY LENGTH(d.merged) DESC LIMIT 20`,
        ).bind(type).all()).results;
      }
      return Response.json(out);
    }

    if ((mode !== 'item' && mode !== 'read') || !id) return new Response('not found', { status: 404 });
    const item = await load(env, id);
    if (!item) return new Response('no such item', { status: 404 });
    if (mode === 'read') return new Response(`read ${item.merged.title}`, { headers: { 'x-mode': 'read' } });

    let body: string;
    let css: string;
    try {
      const { element, getStyleElement } = AppRegistry.getApplication('Item', { initialProps: { item } });
      body = renderToString(element);
      css = renderToStaticMarkup(getStyleElement());
    } catch (e) {
      return new Response(e instanceof Error ? `${e.name}: ${e.message}\n${e.stack}` : String(e), { status: 500 });
    }
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${
      item.merged.title.replace(/[<&]/g, '')
    } · Fandex</title>${css}<style>html,body,#root{height:100%;margin:0;background:#100E0C}#root{display:flex}</style></head><body><div id="root">${body}</div></body></html>`;
    return new Response(html, {
      headers: { 'content-type': 'text/html; charset=utf-8', 'x-mode': 'item', 'x-html-bytes': String(html.length) },
    });
  },
};
