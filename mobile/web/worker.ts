// fandex.org. Almost all of it is files (mobile/web/build.mjs writes them), and
// Cloudflare serves a file without running this Worker at all: free, uncounted,
// no CPU limit. This runs only for an address no file answers:
//
//   /v1/*                       handed to the API Worker, so the app in a browser
//                               talks to its own origin
//   /{type}/{uuid}[/{slug}]     the addresses items had before 2026-08-21. Every
//                               link shared back then points at one. 308 to the
//                               title's real address
//   an app address              /discover, /wishlist, /item/…, and a /{type}/{slug}
//                               too new to have a static page: the app's shell
//   anything else               the 404 page
//
// Nothing is rendered here. The free plan gives a request 10 ms of CPU and the
// item page costs 4 to 35 (docs/app-plan.md, "The website").

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  API: { fetch(request: Request): Promise<Response> };
}

const TYPES = new Set(['movie', 'show', 'game']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9][a-z0-9-]{0,120}$/;
/** The app's one-word screens, other than Home, which is `/` and a file. The site's own addresses. */
const TABS = new Set(['discover', 'calendar', 'wishlist', 'library', 'profile', 'settings', 'insights']);

/** Is this an address only the app can answer? The route table is mobile/src/app. */
function appRoute(parts: string[]): boolean {
  if (parts.length === 1) return TABS.has(parts[0]);
  if (parts[0] === 'item') return parts.length === 2 && UUID.test(parts[1]);
  if (parts[0] === 'open') return parts.length === 4;
  if (parts[0] === 'auth') return parts.length === 2 && parts[1] === 'trakt';
  // The admin pages. The shell is public and says nothing; the data behind it is not.
  if (parts[0] === 'dev') return parts.length === 2 && ['users', 'analytics', 'scoring'].includes(parts[1]);
  // A tag, a person, a studio: built in the app from the catalog on the device. No static page yet.
  if (parts[0] === 'tag' || parts[0] === 'person' || parts[0] === 'studio') return parts.length === 2 && parts[1].length <= 200;
  return parts.length === 2 && TYPES.has(parts[0]) && SLUG.test(parts[1]);
}

async function shell(env: Env, url: URL): Promise<Response> {
  const file = await env.ASSETS.fetch(new Request(new URL('/app-shell', url)));
  const headers = new Headers(file.headers);
  // The same HTML answers many addresses, none of them a page for a search engine.
  headers.set('X-Robots-Tag', 'noindex');
  headers.set('Cache-Control', 'no-cache');
  return new Response(file.body, { status: file.ok ? 200 : 502, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);

    if (parts[0] === 'v1') return env.API.fetch(request);

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }

    if (TYPES.has(parts[0]) && parts.length <= 3 && UUID.test(parts[1] ?? '')) {
      // The slug in an old link is not trusted: two titles can share a name, and
      // the newer one was given a year on the end. The stored slug is the address.
      const res = await env.API.fetch(new Request(new URL(`/v1/items/${parts[1].toLowerCase()}`, url)));
      if (res.ok) {
        const item = (await res.json()) as { type?: string; slug?: string | null };
        if (item.slug && item.type === parts[0]) return Response.redirect(`${url.origin}/${item.type}/${item.slug}`, 308);
      }
      // No such title, or one with no address of its own. Fall through to the 404.
    } else if (appRoute(parts)) {
      return shell(env, url);
    }

    return notFound(env, url);
  },
};

/**
 * The 404 page, with a 404 status.
 *
 * ⚠️ Fetched by name, and wrangler.jsonc sets NO `not_found_handling`. With
 * "404-page" set there, Cloudflare answers a browser's page navigation with
 * the 404 page itself and never runs this Worker, so /search, /library and
 * every old item link showed "Nothing here" in a browser while curl, which
 * sends no Sec-Fetch-Mode header, got the right answer (seen 2026-10-10).
 */
async function notFound(env: Env, url: URL): Promise<Response> {
  const file = await env.ASSETS.fetch(new Request(new URL('/404', url)));
  const headers = new Headers(file.headers);
  headers.set('X-Robots-Tag', 'noindex');
  headers.set('Cache-Control', 'no-cache');
  return new Response(file.body, { status: 404, headers });
}
