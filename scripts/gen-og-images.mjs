// Writes the pictures a pasted fandex.org link shows (og:image, twitter:image):
//
//   public/og/home.png      1200 x 630, for the home page: icon, name, tagline
//   public/og/default.png   1200 x 630, for every other page without a picture of its own
//
// A port of the old site's opengraph-image.tsx (tag old-site-final): the app's
// dark surface, the two-card icon, the name and a line under it. The old one
// was drawn without the serif; this one has the app's own fonts.
//
// No new dependency and nothing from the internet: sharp is already installed
// under worker/ (Wrangler brings it), it draws public/icon.svg, and it sets the
// text with the font files the app ships (@expo-google-fonts in mobile/).
//
// Run: node scripts/gen-og-images.mjs   (then commit the two files)
// mobile/web/build.mjs copies them into the site and names them in each page.

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sharp = createRequire(path.join(repo, 'worker', 'package.json'))('sharp');
const fonts = path.join(repo, 'mobile', 'node_modules', '@expo-google-fonts');
const SERIF = path.join(fonts, 'dm-serif-display', '400Regular', 'DMSerifDisplay_400Regular.ttf');
const SANS = path.join(fonts, 'space-grotesk', '400Regular', 'SpaceGrotesk_400Regular.ttf');
for (const f of [SERIF, SANS]) if (!fs.existsSync(f)) throw new Error(`Missing font ${f}: run npm ci in mobile/`);

const W = 1200;
const H = 630;
const SURFACE = '#100E0C';
const TEXT = '#EDE7DC';
const SECONDARY = '#9A8F80';

// The icon's two cards without its square background (public/icon.svg).
const ICON = 200;
const iconSvg = fs.readFileSync(path.join(repo, 'public', 'icon.svg'), 'utf8')
  .replace(/<rect width="512" height="512"[^>]*\/>/, '');

/** One line of text as a transparent PNG, set in the given font file. */
async function text(str, { fontfile, family, size, colour }) {
  const esc = str.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return sharp({ text: { text: `<span foreground="${colour}">${esc}</span>`, font: `${family} ${size}`, fontfile, rgba: true, dpi: 72 } })
    .png().toBuffer({ resolveWithObject: true });
}

async function card(file, line) {
  const icon = await sharp(Buffer.from(iconSvg)).resize(ICON, ICON).png().toBuffer();
  const name = await text('Fandex', { fontfile: SERIF, family: 'DM Serif Display', size: 120, colour: TEXT });
  const sub = await text(line, { fontfile: SANS, family: 'Space Grotesk', size: 38, colour: SECONDARY });
  // The icon's cards fill about half of its square, so the square sits close to the name.
  const gapIcon = 0;
  const gapSub = 40;
  const total = ICON + gapIcon + name.info.height + gapSub + sub.info.height;
  let y = Math.round((H - total) / 2);
  const layers = [];
  layers.push({ input: icon, left: Math.round((W - ICON) / 2), top: y });
  y += ICON + gapIcon;
  layers.push({ input: name.data, left: Math.round((W - name.info.width) / 2), top: y });
  y += name.info.height + gapSub;
  layers.push({ input: sub.data, left: Math.round((W - sub.info.width) / 2), top: y });
  const out = path.join(repo, 'public', 'og', file);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await sharp({ create: { width: W, height: H, channels: 3, background: SURFACE } }).composite(layers).png({ compressionLevel: 9 }).toFile(out);
  console.log(`${path.relative(repo, out)}  ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
}

await card('home.png', 'Your index of every game, movie, show and book');
await card('default.png', 'fandex.org');
