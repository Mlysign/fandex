// Build src/app/favicon.ico from src/app/icon.svg.
//
// Why this exists (2026-08-20): Google's search results showed a stale favicon
// for fandex.org. Two causes, both fixed here and in the www redirect:
//
//   1. `https://fandex.org/favicon.ico` returned 404. Next was emitting
//      <link rel="icon"> for icon.svg and icon.png, which is correct HTML, but
//      Google's favicon fetcher also probes /favicon.ico at the host root and a
//      404 there is a common reason it falls back to a cached or generic mark.
//   2. icon.png is 256x256. Google's documented guidance is a square that is a
//      MULTIPLE OF 48 (48, 96, 144, 192). 256 is not, so it can be skipped.
//      The .ico below ships 16/32/48, which satisfies both the legacy sizes and
//      the 48 rule.
//
// Run with `node scripts/build-favicon.mjs` after changing the brand mark. It is
// deliberately a manual step and not a build hook: the output is committed, and a
// favicon that regenerates on every build is a favicon nobody ever looks at.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src", "app", "icon.svg");
const OUT = path.join(ROOT, "src", "app", "favicon.ico");

// 16 and 32 are what a browser tab and a bookmark bar actually render; 48 is the
// size Google's favicon guidance is written around.
const SIZES = [16, 32, 48];

const svg = fs.readFileSync(SRC);

// The app icon frames the mark at about 56% of the square, which is right for a
// launcher tile and much too airy for a 16px browser tab or a search result. So
// the mark is trimmed out of its background and re-framed at ~84% here rather
// than kept as a second hand-tuned SVG that would drift from Logo.tsx.
const BACKGROUND = { r: 0x10, g: 0x0e, b: 0x0c, alpha: 1 };
const MARGIN = 0.095; // of the trimmed mark's longest edge, per side

const trimmed = await sharp(svg, { density: 512 })
  .resize(512, 512, { fit: "contain" })
  .trim({ background: BACKGROUND, threshold: 8 })
  .toBuffer({ resolveWithObject: true });

const edge = Math.max(trimmed.info.width, trimmed.info.height);
const pad = Math.round(edge * MARGIN);
const framed = await sharp(trimmed.data)
  .extend({
    top: pad + Math.round((edge - trimmed.info.height) / 2),
    bottom: pad + Math.round((edge - trimmed.info.height) / 2),
    left: pad + Math.round((edge - trimmed.info.width) / 2),
    right: pad + Math.round((edge - trimmed.info.width) / 2),
    background: BACKGROUND,
  })
  .toBuffer();

const pngs = await Promise.all(
  SIZES.map((size) =>
    sharp(framed)
      .resize(size, size, { fit: "fill" })
      .png({ compressionLevel: 9 })
      .toBuffer(),
  ),
);

// ICO container. Each entry points at a PNG payload rather than a BMP one, which
// every browser and Windows Vista onward reads natively and which keeps the alpha
// channel intact without the AND-mask dance a BMP entry needs.
const HEADER = 6;
const ENTRY = 16;
const header = Buffer.alloc(HEADER);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // 1 = icon
header.writeUInt16LE(pngs.length, 4);

let offset = HEADER + ENTRY * pngs.length;
const entries = pngs.map((png, i) => {
  const e = Buffer.alloc(ENTRY);
  e.writeUInt8(SIZES[i] === 256 ? 0 : SIZES[i], 0); // width, 0 means 256
  e.writeUInt8(SIZES[i] === 256 ? 0 : SIZES[i], 1); // height
  e.writeUInt8(0, 2); // palette size, 0 for truecolor
  e.writeUInt8(0, 3); // reserved
  e.writeUInt16LE(1, 4); // colour planes
  e.writeUInt16LE(32, 6); // bits per pixel
  e.writeUInt32LE(png.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += png.length;
  return e;
});

fs.writeFileSync(OUT, Buffer.concat([header, ...entries, ...pngs]));

const rel = path.relative(ROOT, OUT).split(path.sep).join("/");
console.log(`wrote ${rel}  ${SIZES.join("/")}px  ${fs.statSync(OUT).size} bytes`);
