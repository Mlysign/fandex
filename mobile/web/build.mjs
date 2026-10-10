// Build the website: everything fandex.org serves, as files.
//
//   node mobile/web/build.mjs                 the whole build
//   node mobile/web/build.mjs --skip-export   reuse the last app export (dist/app)
//   node mobile/web/build.mjs --limit=40      render only the first 40 titles (a try-out; never deploy it)
//
// To build AND publish, use publish.mjs. Do not run `wrangler deploy` on this
// folder by hand: it uploads whatever is there, a half-built site included.
//
// What it writes into mobile/web/dist/site:
//   the app            Expo's web export: index.html, the bundle, fonts
//   /{type}/{slug}     one static page per title in the pool, rendered from the
//                      app's own ItemPage component, with its search metadata
//   /legal/{en,de}/*   the legal pages, from src/lib/legal
//   index.html         the app, plus a placeholder a crawler can read
//   app-shell.html     the app with nothing else, for every app-only address
//   404.html, robots.txt, sitemap.xml, _headers
//
// Why files and not a Worker that renders: the free Worker has 10 ms of CPU a
// request and the item page costs 4 to 35 (docs/app-plan.md, "The website").
//
// ⚠️ A build that fails must leave nothing to deploy. Publishing replaces the
// whole site, so a build that lost half its pages would delete them from the
// web. Every step below throws instead of carrying on short, the page count is
// checked against the pool, and the output folder is only moved into place at
// the very end.

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mobile = path.join(here, '..');
const repo = path.join(mobile, '..');
const DIST = path.join(here, 'dist');
const APP = path.join(DIST, 'app');
const STAGE = path.join(DIST, 'site.next');
const OUT = path.join(DIST, 'site');
const CACHE = path.join(DIST, 'cache', 'items');

const API = (process.env.FANDEX_API ?? 'https://fandex-api.fandex-worker.workers.dev').replace(/\/+$/, '');
const SITE = 'https://fandex.org';
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const limit = Number(args.find((a) => a.startsWith('--limit='))?.slice(8) ?? 0);

const TYPES = ['movie', 'show', 'game'];
const SLUG = /^[a-z0-9][a-z0-9-]{0,120}$/;
const TITLE = 'Fandex: your index of every game, movie & show';
const DESCRIPTION = "One index for every game, movie and show. Fandex tracks your wishlist and learns your taste, so you know what's out next.";

const started = Date.now();
const step = (msg) => console.log(`[${((Date.now() - started) / 1000).toFixed(0).padStart(3)}s] ${msg}`);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ── 1. The app ───────────────────────────────────────────────────────────────

if (!flag('skip-export')) {
  step('exporting the app for the web');
  // The checkout is in OneDrive, which holds a file open while it uploads it. A
  // build started soon after the last one found `metadata.json` locked for
  // about half a minute, so the delete waits up to a minute before giving up.
  fs.rmSync(APP, { recursive: true, force: true, maxRetries: 20, retryDelay: 3000 });
  execSync('npx expo export --platform web --output-dir web/dist/app', {
    cwd: mobile,
    stdio: ['ignore', 'ignore', 'inherit'],
    // "/" makes the app call /v1/* on its own origin (src/lib/config.ts). Set
    // here and not on a command line: Git Bash rewrites a lone "/" in an
    // environment variable into the path of its own install folder.
    env: { ...process.env, EXPO_PUBLIC_API_URL: '/' },
  });
}
const shell = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
const bundle = shell.match(/<script src="(\/_expo\/static\/js\/web\/index-[0-9a-f]+\.js)" defer><\/script>/)?.[1];
if (!bundle) throw new Error('The export has no app bundle in its index.html');
const bundleText = fs.readFileSync(path.join(APP, bundle), 'utf8');
if (bundleText.includes('fandex-api.fandex-worker.workers.dev') || /Program Files/.test(bundleText)) {
  throw new Error('The app bundle was not built for the website: it does not call /v1 on its own origin');
}

// ── 2. The renderer ──────────────────────────────────────────────────────────

step('bundling the renderer');
const esbuild = await import(pathToFileURL(path.join(repo, 'worker', 'node_modules', 'esbuild', 'lib', 'main.js')).href);
await esbuild.build({
  // Aliases resolve from the working directory, so it has to be the package that holds react-native-web.
  absWorkingDir: mobile,
  entryPoints: [path.join(here, 'render.tsx')],
  outfile: path.join(DIST, 'render.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  conditions: ['workerd', 'worker', 'browser'],
  mainFields: ['browser', 'module', 'main'],
  // The same rules Expo's web build follows: a `.web.*` file wins over its plain sibling.
  resolveExtensions: ['.web.tsx', '.web.ts', '.web.jsx', '.web.js', '.tsx', '.ts', '.jsx', '.js', '.json'],
  jsx: 'automatic',
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', 'process.env.EXPO_OS': '"web"' },
  alias: { 'react-native': 'react-native-web' },
  plugins: [{
    name: 'app-paths',
    setup(build) {
      // `~/x` is mobile/src/x and `@/x` is the site's src/x, as in metro.config.js.
      build.onResolve({ filter: /^~\// }, (a) => build.resolve(`./${a.path.slice(2)}`, { resolveDir: path.join(mobile, 'src'), kind: a.kind }));
      build.onResolve({ filter: /^@\// }, (a) => build.resolve(`./${a.path.slice(2)}`, { resolveDir: path.join(repo, 'src'), kind: a.kind }));
    },
  }],
  logLevel: 'warning',
});
const { renderItem, itemHead, legalDocuments, ITEM_PAGE_CSS } = await import(`${pathToFileURL(path.join(DIST, 'render.mjs')).href}?t=${started}`);

// ── 3. The data ──────────────────────────────────────────────────────────────

async function getJson(url, tries = 4) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`${res.status} from ${url}`);
      return await res.json();
    } catch (e) {
      if (attempt >= tries) throw e;
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
}

step(`reading the pool from ${API}`);
const taxonomy = await getJson(`${API}/v1/taxonomy`);
if (!taxonomy) throw new Error('No taxonomy');
/** @type {{ updatedAt: number, vector: any }[]} */
const pool = [];
let poolCount = null;
for (let cursor = { since: 0, after: '' }; ;) {
  const page = await getJson(`${API}/v1/catalog/delta?since=${cursor.since}&after=${encodeURIComponent(cursor.after)}&limit=200&count=1`);
  if (!page) throw new Error('The catalog delta answered 404');
  poolCount ??= page.poolCount;
  for (const it of page.items) pool.push({ updatedAt: it.updatedAt, vector: it.vector });
  if (page.done) break;
  cursor = page.next;
}
if (!pool.length) throw new Error('The pool came back empty');
// Receiving a row twice is how the delta stays safe (worker/src/catalog/read.ts). Keep the newest.
const byId = new Map();
for (const p of pool) if ((byId.get(p.vector.id)?.updatedAt ?? -1) <= p.updatedAt) byId.set(p.vector.id, p);
let wanted = [...byId.values()].filter((p) => TYPES.includes(p.vector.type) && p.vector.slug && SLUG.test(p.vector.slug));
const unaddressed = byId.size - wanted.length;
if (limit) wanted = wanted.slice(0, limit);
step(`${byId.size} titles in the pool, ${unaddressed} without an address`);

// One request per title, eight at a time. A title is asked for again only when
// its `updatedAt` moved, so a second build the same day asks for almost nothing.
fs.mkdirSync(CACHE, { recursive: true });
const details = new Map();
let fetched = 0;
let gone = 0;
async function detail(p) {
  const file = path.join(CACHE, `${p.vector.id}.json`);
  try {
    const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (cached.updatedAt === p.updatedAt) return cached;
  } catch { /* not cached, or half written */ }
  const item = await getJson(`${API}/v1/items/${p.vector.id}`);
  // Removed between the two reads. The only way a title may be missing from a build.
  if (!item) { gone++; return null; }
  fetched++;
  fs.writeFileSync(file, JSON.stringify(item));
  return item;
}
{
  let next = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (next < wanted.length) {
      const p = wanted[next++];
      const item = await detail(p);
      if (item) details.set(p.vector.id, item);
    }
  }));
}
step(`${details.size} titles loaded (${fetched} fetched, ${details.size - fetched} from the last build, ${gone} gone)`);

// ── 4. The pages ─────────────────────────────────────────────────────────────

fs.rmSync(STAGE, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
fs.cpSync(APP, STAGE, { recursive: true });
fs.rmSync(path.join(STAGE, 'metadata.json'), { force: true });
// The site's own icons, the ones the old site served (src/app/favicon.ico, icon.svg, public/icon-*.png).
fs.copyFileSync(path.join(repo, 'src', 'app', 'favicon.ico'), path.join(STAGE, 'favicon.ico'));
fs.copyFileSync(path.join(repo, 'src', 'app', 'icon.svg'), path.join(STAGE, 'icon.svg'));
fs.copyFileSync(path.join(repo, 'public', 'icon-192.png'), path.join(STAGE, 'icon-192.png'));

// The app loads its fonts in JavaScript. A static page has to name them itself,
// under the family names the app's styles use (src/theme.ts).
const FAMILIES = ['DMSerifDisplay_400Regular', 'SpaceGrotesk_400Regular', 'SpaceGrotesk_600SemiBold', 'SpaceMono_400Regular'];
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}
const assetFiles = walk(path.join(STAGE, 'assets'));
const fontCss = FAMILIES.map((family) => {
  const file = assetFiles.find((f) => path.basename(f).startsWith(`${family}.`) && f.endsWith('.ttf'));
  if (!file) throw new Error(`The export has no font file for ${family}`);
  // Encoded, because the folder is "@expo-google-fonts" and Cloudflare answers
  // a raw "@" in a path with a redirect to "%40": one more round trip per font.
  const url = `/${path.relative(STAGE, file).split(path.sep).map(encodeURIComponent).join('/')}`;
  return `@font-face{font-family:"${family}";src:url("${url}") format("truetype");font-display:swap}`;
}).join('');

const C = { surface: '#100E0C', elevated: '#181512', border: 'rgba(237,231,220,0.09)', text: '#EDE7DC', secondary: '#9A8F80', muted: '#6F665A', accent: '#C8A24B' };
const SERIF = '"DMSerifDisplay_400Regular",Georgia,serif';
const SANS = '"SpaceGrotesk_400Regular",system-ui,sans-serif';
const MONO = '"SpaceMono_400Regular",ui-monospace,monospace';

// The app's own page frame (the export's index.html says the same): a full-height
// body that does not scroll, because the screens scroll inside themselves.
const FRAME_CSS = `html,body{height:100%;margin:0;background:${C.surface}}body{overflow:hidden}#root{display:flex;height:100%;flex:1}`
  // The static copy lies over the app's empty root until the app removes it (src/lib/prerender.ts).
  + `#prerender{position:fixed;top:0;right:0;bottom:0;left:0;z-index:1;display:flex;background:${C.surface}}`
  // The static page carries both navigation bars and shows the one for its width. The app picks in JavaScript.
  + `@media (min-width:768px){[data-nav="bottom"]{display:none!important}}@media (max-width:767px){[data-nav="top"]{display:none!important}}`;

const LEGAL = {
  en: [['privacy', 'Privacy'], ['terms', 'Terms'], ['support', 'Contact'], ['imprint', 'Imprint']],
  de: [['privacy', 'Datenschutz'], ['terms', 'AGB'], ['support', 'Kontakt'], ['imprint', 'Impressum']],
};
const legalNav = (locale) => `<nav class="legal" aria-label="Legal">${LEGAL[locale].map(([doc, label]) => `<a href="/legal/${locale}/${doc}">${label}</a>`).join('')}</nav>`;

function social({ title, description, url, image, alt }) {
  return `<meta property="og:type" content="website"><meta property="og:site_name" content="Fandex">`
    + `<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${esc(url)}">`
    + (image ? `<meta property="og:image" content="${esc(image)}"><meta property="og:image:alt" content="${esc(alt ?? title)}">` : '')
    + `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(description)}">`
    + (image ? `<meta name="twitter:image" content="${esc(image)}">` : '');
}

const ICONS = '<link rel="icon" href="/favicon.ico" sizes="any"><link rel="icon" href="/icon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/icon-192.png">';
const HEAD_START = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
  + `<meta name="theme-color" content="${C.surface}">${ICONS}`;

// An item page starts the app only for somebody signed in. Everybody else,
// crawlers included, already has the whole page: the app would add nothing but
// a 3.7 MB download and a catalog sync against the Worker's daily budget.
// "fandex.session" is where the web build keeps the session (src/lib/storage.ts).
//
// The second half makes the back arrow go back, when there is a Fandex page to
// go back to. Without it the arrow is a plain link home, which is also fine.
const ITEM_SCRIPT = `(function(){var b=document.querySelector('#prerender a[aria-label="Fandex, home"]');`
  + `if(b&&history.length>1&&document.referrer.indexOf(location.origin+"/")===0)b.addEventListener("click",function(e){e.preventDefault();history.back()});`
  + `try{if(!localStorage.getItem("fandex.session"))return}catch(e){return}`
  + `var s=document.createElement("script");s.src="/app-boot.js";document.body.appendChild(s)})()`;

// The pages name this small file and not the app's bundle, whose name changes with
// every build of the app. Otherwise a one-line change to the app rewrote all 4,561
// pages, and publishing meant uploading 250 MB again (it failed five times in a row
// on 2026-10-10). This file is the only thing that knows the bundle's current name.
const APP_BOOT = `(function(){var s=document.createElement("script");s.src=${JSON.stringify(bundle)};document.body.appendChild(s)})()`;
fs.writeFileSync(path.join(STAGE, 'app-boot.js'), APP_BOOT);

step(`rendering ${details.size} item pages`);
const urls = [];
let largest = 0;
for (const item of details.values()) {
  if (!item.slug || !SLUG.test(item.slug) || !TYPES.includes(item.type)) continue;
  const head = itemHead(item);
  const { body, css } = renderItem(item, taxonomy);
  // What check-html.mjs guards: a page with no heading or no image in its HTML
  // is the react-native-web default coming back, and a crawler gets nothing.
  if (!body.includes('role="heading"')) throw new Error(`${item.type}/${item.slug} rendered without a heading`);
  const html = `${HEAD_START}<title>${esc(head.title)} · Fandex</title><meta name="description" content="${esc(head.description)}">`
    + `<link rel="canonical" href="${esc(head.canonical)}">${social({ title: head.title, description: head.description, url: head.canonical, image: head.image, alt: item.merged.title })}`
    + `<style>${fontCss}${FRAME_CSS}</style>${css}<style id="fandex-item-layout">${ITEM_PAGE_CSS}</style><script type="application/ld+json">${head.jsonLd}</script></head>`
    + `<body><div id="prerender" data-page="item">${body}</div><div id="root"></div><script>${ITEM_SCRIPT}</script></body></html>`;
  const dir = path.join(STAGE, item.type);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${item.slug}.html`), html);
  largest = Math.max(largest, html.length);
  urls.push({ loc: head.canonical, lastmod: new Date(item.updatedAt * 1000).toISOString().slice(0, 10) });
}
step(`${urls.length} item pages written, the largest ${(largest / 1024).toFixed(0)} KB`);

// ── The app's two shells ─────────────────────────────────────────────────────

// Every address that is the app's alone (/search, /library, /item/…) is served
// this by the Worker. Nothing for a search engine in it, and it says so.
fs.writeFileSync(path.join(STAGE, 'app-shell.html'),
  shell.replace('</title>', `</title><meta name="robots" content="noindex"><meta name="theme-color" content="${C.surface}">`));

// The home page is the app too, with something to read until it is up and for
// whoever never runs it: the name, the line under it, and the most-voted titles
// as links. Those links are how a crawler gets from the front door to a title.
const popular = (type) => [...details.values()]
  .filter((i) => i.type === type && i.slug)
  .sort((a, b) => (b.vector.communityVotes ?? 0) - (a.vector.communityVotes ?? 0))
  .slice(0, 30);
const homeList = (type, label) => `<section><h2>${label}</h2><ul>${popular(type).map((i) =>
  `<li><a href="/${i.type}/${i.slug}">${esc(i.merged.title)}${i.merged.releaseDate ? ` <span>${i.merged.releaseDate.slice(0, 4)}</span>` : ''}</a></li>`).join('')}</ul></section>`;
const HOME_CSS = `.ph{flex:1;overflow-y:auto;color:${C.text};font-family:${SANS}}`
  + `.ph header{min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:0 20px;text-align:center}`
  + `.ph .mark{margin:0;font-family:${SERIF};font-size:34px;line-height:35px}`
  + `.ph h1{margin:0;font-family:${MONO};font-weight:400;font-size:11px;letter-spacing:1.3px;text-transform:uppercase;color:${C.secondary}}`
  + `.ph main{max-width:720px;margin:0 auto;padding:0 20px 44px}`
  + `.ph h2{margin:24px 0 8px;font-family:${SERIF};font-weight:400;font-size:22px}`
  + `.ph ul{margin:0;padding:0;list-style:none;columns:2;column-gap:20px}`
  + `.ph li a{display:block;padding:6px 0;color:${C.text};text-decoration:none;font-size:14px;line-height:22px}`
  + `.ph li span{font-family:${MONO};font-size:11px;color:${C.secondary}}`
  + `.legal{display:flex;flex-wrap:wrap;column-gap:16px;margin-top:24px}.legal a{font-family:${MONO};font-size:11px;line-height:44px;letter-spacing:.5px;color:${C.secondary};text-decoration:none}`;
const home = shell
  .replace('<title>Fandex</title>',
    `<title>${esc(TITLE)}</title><meta name="description" content="${esc(DESCRIPTION)}"><link rel="canonical" href="${SITE}/">`
    + `<meta name="theme-color" content="${C.surface}">${social({ title: TITLE, description: DESCRIPTION, url: `${SITE}/` })}`
    + `<style>${fontCss}html,body{background:${C.surface}}#prerender{position:fixed;top:0;right:0;bottom:0;left:0;z-index:1;display:flex;background:${C.surface}}${HOME_CSS}</style>`)
  .replace('<div id="root"></div>',
    `<div id="prerender"><div class="ph"><header><p class="mark">Fandex</p><h1>Your index of every game, movie &amp; show</h1></header>`
    + `<main>${homeList('movie', 'Movies')}${homeList('show', 'Shows')}${homeList('game', 'Games')}${legalNav('en')}</main></div></div><div id="root"></div>`);
if (!home.includes('id="prerender"') || !home.includes('rel="canonical"')) throw new Error('The export\'s index.html changed shape: the home page was not written');
fs.writeFileSync(path.join(STAGE, 'index.html'), home);

// ── Legal ────────────────────────────────────────────────────────────────────

const DOC_CSS = `html,body{margin:0;background:${C.surface};color:${C.secondary};font-family:${SANS};font-size:14px;line-height:1.65}`
  + `main{max-width:720px;margin:0 auto;padding:24px 20px 44px}`
  + `.top{display:flex;justify-content:space-between;align-items:center;gap:12px}.top a{color:${C.text};text-decoration:none;font-family:${SERIF};font-size:22px;line-height:44px}`
  + `.locale{display:inline-flex;border:1px solid ${C.border};border-radius:999px;background:${C.elevated};padding:2px;font-family:${MONO};font-size:12px}`
  + `.locale a{font-family:${MONO};font-size:12px;line-height:32px;padding:0 12px;border-radius:999px;color:${C.secondary}}.locale a[aria-current]{background:${C.accent};color:${C.surface}}`
  + `h1{margin:24px 0 0;font-family:${SERIF};font-weight:400;font-size:34px;line-height:1.05;color:${C.text}}`
  + `.updated{margin:6px 0 0;font-family:${MONO};font-size:12px}`
  + `h2{margin:32px 0 8px;font-family:${SERIF};font-weight:400;font-size:18px;color:${C.text}}`
  + `p,address{margin:12px 0 0;font-style:normal}ul{margin:12px 0 0;padding-left:20px}li{margin-top:4px}`
  + `p a{color:${C.accent};text-underline-offset:2px}.wait{font-style:italic}`
  + `.legal{display:flex;flex-wrap:wrap;column-gap:16px;margin-top:40px;padding-top:12px;border-top:1px solid ${C.border}}`
  + `.legal a{font-family:${MONO};font-size:11px;line-height:44px;letter-spacing:.5px;color:${C.secondary};text-decoration:none}`;

// The postal address is base64 in the page and decoded in the browser, so the
// HTML carries no plain text for a harvester to match. The reasoning, and what
// this does not protect against, is in src/components/legal/ProtectedText.tsx.
const PROTECTED_SCRIPT = `document.querySelectorAll("[data-protected]").forEach(function(p){try{var b=Uint8Array.from(atob(p.dataset.protected),function(c){return c.charCodeAt(0)});`
  + `var a=document.createElement("address");new TextDecoder().decode(b).split("\\n").forEach(function(l){var s=document.createElement("span");s.style.display="block";s.textContent=l;a.appendChild(s)});p.replaceWith(a)}catch(e){}})`;

function legalBlock(block, locale) {
  if (typeof block === 'string') return `<p>${esc(block)}</p>`;
  if ('rich' in block) {
    return `<p>${block.rich.map((part) => (typeof part === 'string' ? esc(part)
      : `<a href="${esc(part.href)}"${part.external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${esc(part.label)}</a>`)).join('')}</p>`;
  }
  if ('protected' in block) {
    const fallback = locale === 'de'
      ? 'Die Postanschrift wird erst im Browser eingefügt. Bitte aktivieren Sie JavaScript, oder fordern Sie sie unter hello@fandex.org an.'
      : 'The postal address is inserted in the browser. Please enable JavaScript, or request it at hello@fandex.org.';
    return `<p class="wait" data-protected="${esc(block.protected)}">${esc(fallback)}</p>`;
  }
  return `<ul>${block.list.map((li) => `<li>${esc(li)}</li>`).join('')}</ul>`;
}

const legal = legalDocuments();
for (const { locale, doc, content } of legal) {
  const canonical = `${SITE}/legal/${locale}/${doc}`;
  const body = content.sections.map((s) => `<section><h2>${esc(s.heading)}</h2>${s.body.map((b) => legalBlock(b, locale)).join('')}</section>`).join('');
  const usesProtected = content.sections.some((s) => s.body.some((b) => typeof b === 'object' && 'protected' in b));
  const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`
    + `<meta name="theme-color" content="${C.surface}">${ICONS}<title>${esc(content.title)} · Fandex</title>`
    + `<link rel="canonical" href="${canonical}">${['en', 'de'].map((l) => `<link rel="alternate" hreflang="${l}" href="${SITE}/legal/${l}/${doc}">`).join('')}`
    // The imprint carries a home address. Out of every index, as on the old site.
    + (doc === 'imprint' ? '<meta name="robots" content="noindex, nofollow, noarchive, nosnippet">' : '')
    + `<style>${fontCss}${DOC_CSS}</style></head><body><main>`
    + `<div class="top"><a href="/">Fandex</a><nav class="locale" aria-label="Language">${['en', 'de'].map((l) =>
      `<a href="/legal/${l}/${doc}"${l === locale ? ' aria-current="true"' : ''}>${l.toUpperCase()}</a>`).join('')}</nav></div>`
    + `<h1>${esc(content.title)}</h1><p class="updated">${locale === 'de' ? 'Zuletzt aktualisiert' : 'Last updated'}: ${esc(content.updated)}</p>`
    + (content.intro ?? []).map((p) => `<p>${esc(p)}</p>`).join('') + body + legalNav(locale)
    + `</main>${usesProtected ? `<script>${PROTECTED_SCRIPT}</script>` : ''}</body></html>`;
  const dir = path.join(STAGE, 'legal', locale);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${doc}.html`), html);
  if (doc !== 'imprint') urls.push({ loc: canonical, lastmod: content.updated });
}
if (legal.length !== 8) throw new Error(`Expected 8 legal pages, wrote ${legal.length}`);

// ── 404, robots, sitemap, headers ────────────────────────────────────────────

fs.writeFileSync(path.join(STAGE, '404.html'),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">`
  + `<meta name="theme-color" content="${C.surface}">${ICONS}<title>Nothing here · Fandex</title><style>${fontCss}${DOC_CSS}</style></head>`
  + `<body><main><div class="top"><a href="/">Fandex</a></div><h1>Nothing here</h1><p>Fandex has no page at this address.</p><p><a href="/">Go to the home page</a></p>${legalNav('en')}</main></body></html>`);

// /v1/ is the API. A crawler that runs the home page's script would otherwise
// spend the Worker's daily requests on a catalog sync; the calendar is the one
// read the home page needs to show anything, and it is cached.
fs.writeFileSync(path.join(STAGE, 'robots.txt'), [
  'User-agent: *',
  'Allow: /',
  'Allow: /v1/calendar/',
  'Disallow: /v1/',
  // The old site's list (src/app/robots.ts): the screens that are yours, or that need the app to show anything.
  ...['/item/', '/open/', '/auth/', '/discover', '/calendar', '/wishlist', '/library', '/profile', '/settings', '/insights', '/dev/', '/app-shell'].map((p) => `Disallow: ${p}`),
  '',
  `Sitemap: ${SITE}/sitemap.xml`,
  '',
].join('\n'));

urls.unshift({ loc: `${SITE}/`, lastmod: new Date().toISOString().slice(0, 10) });
fs.writeFileSync(path.join(STAGE, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${
    urls.map((u) => `<url><loc>${esc(u.loc)}</loc><lastmod>${u.lastmod}</lastmod></url>`).join('\n')}\n</urlset>\n`);

// The security headers the old site sent (next.config.ts), on every file.
fs.writeFileSync(path.join(STAGE, '_headers'), [
  '/*',
  '  X-Content-Type-Options: nosniff',
  '  X-Frame-Options: DENY',
  '  Referrer-Policy: strict-origin-when-cross-origin',
  '  Strict-Transport-Security: max-age=63072000; includeSubDomains',
  '  Permissions-Policy: camera=(), microphone=(), geolocation=(), browsing-topics=()',
  "  Content-Security-Policy: frame-ancestors 'none'",
  // Both folders hold files named by their content hash.
  '/_expo/static/*',
  '  Cache-Control: public, max-age=31536000, immutable',
  '/assets/*',
  '  Cache-Control: public, max-age=31536000, immutable',
  // Always asked for again: it is what points a static page at the current app.
  '/app-boot.js',
  '  Cache-Control: no-cache',
  '/legal/:locale/imprint',
  '  X-Robots-Tag: noindex, nofollow, noarchive, nosnippet',
  '/app-shell',
  '  X-Robots-Tag: noindex',
  '',
].join('\n'));

// ── 5. Is this a whole site? ─────────────────────────────────────────────────

const itemPages = urls.filter((u) => TYPES.some((t) => u.loc.startsWith(`${SITE}/${t}/`))).length;
const expected = (poolCount ?? byId.size) - unaddressed;
if (!limit && itemPages < expected * 0.98) {
  throw new Error(`Only ${itemPages} item pages for a pool of ${expected} addressed titles. Not publishing a short site.`);
}
const files = walk(STAGE).length;
// Cloudflare's limit on a free plan is 20,000 files per deploy.
if (files > 19000) throw new Error(`${files} files: over what one deploy may hold`);

// Two renames, not a delete and a rename. Deleting 4,600 files can fail half
// way (it did once, on a folder a shell was standing in), and what is left is
// a short site that looks like a site. A rename either happens or does not.
// build.json is written last and is what publish.mjs checks the folder against.
const OLD = path.join(DIST, 'site.old');
const sweep = { recursive: true, force: true, maxRetries: 5, retryDelay: 300 };
fs.rmSync(OLD, sweep);
fs.rmSync(path.join(DIST, 'build.json'), { force: true });
// This folder is inside OneDrive on the machine it is built on, and OneDrive
// holds a folder it is still scanning: a rename then fails with EPERM for a few
// seconds. Wait and try again; a failure after that leaves the old site as it was.
async function rename(from, to) {
  for (let attempt = 1; ; attempt++) {
    try { fs.renameSync(from, to); return; } catch (e) {
      if (attempt >= 12 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
      await new Promise((r) => setTimeout(r, 2500));
    }
  }
}
if (fs.existsSync(OUT)) await rename(OUT, OLD);
await rename(STAGE, OUT);
fs.writeFileSync(path.join(DIST, 'build.json'), JSON.stringify({ builtAt: new Date().toISOString(), itemPages, files, poolCount, limited: !!limit }, null, 2));
try { fs.rmSync(OLD, sweep); } catch { /* the next build clears it */ }
step(`done: ${itemPages} item pages, ${files} files in ${path.relative(repo, OUT)}${limit ? '  (LIMITED BUILD, do not deploy)' : ''}`);
