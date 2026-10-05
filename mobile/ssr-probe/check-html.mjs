// Does the item page render on a server, and what is in the HTML?
//
//   node mobile/ssr-probe/build.mjs && node mobile/ssr-probe/check-html.mjs [item-id ...]
//
// Fetches each item and the taxonomy from the live Worker (two public reads),
// renders the page in Node with the bundle build.mjs wrote, and counts what a
// crawler would find: images, links, the heading, the trailer. Exits 1 if a
// page comes out with no image or no link, which is how it came out before
// 2026-10-05.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const API = process.env.FANDEX_API ?? 'https://fandex-api.fandex-worker.workers.dev';
// A film, a show and a game, the largest docs of each on 2026-10-05.
const ids = process.argv.slice(2).length ? process.argv.slice(2) : [
  'e084cd6f-114e-4c18-8de2-359365ccabc0', '77635544-5fbd-4f92-af5f-9e532b3bd044', '84758701-100c-4664-9ac6-508435b71421',
];

const { renderItem } = await import(pathToFileURL(path.join(here, 'dist', 'render.js')).href);
const json = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} from ${url}`);
  return res.json();
};

const taxonomy = await json(`${API}/v1/taxonomy`);
let bad = 0;
for (const id of ids) {
  const item = await json(`${API}/v1/items/${id}`);
  const t0 = performance.now();
  const { body, css } = renderItem(item, taxonomy);
  const ms = performance.now() - t0;
  const count = (re) => (body.match(re) ?? []).length;
  const found = {
    bytes: body.length + css.length,
    img: count(/<img /g),
    links: count(/<a [^>]*href=/g),
    heading: count(/role="heading"/g),
    trailer: count(/<iframe /g),
    ms: Math.round(ms * 10) / 10,
  };
  console.log(`${item.type.padEnd(5)} ${item.merged.title.slice(0, 34).padEnd(34)} ${JSON.stringify(found)}`);
  if (!found.img || !found.links || found.heading !== 1) bad++;
  if (process.env.WRITE_HTML) {
    fs.writeFileSync(path.join(here, 'dist', `${id}.html`),
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${item.merged.title.replace(/[<&]/g, '')}</title>${css}<style>html,body,#root{height:100%;margin:0;background:#100E0C}#root{display:flex}</style></head><body><div id="root">${body}</div></body></html>`);
  }
}
if (bad) {
  console.error(`${bad} page(s) rendered without an image, a link or exactly one heading`);
  process.exit(1);
}
