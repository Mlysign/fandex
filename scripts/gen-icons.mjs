// P14 — generate the PWA / app icons from one SVG. Rasterized with sharp at
// the sizes a manifest + iOS need. Re-run after editing the SVG or swapping
// in real art:
//   node scripts/gen-icons.mjs
import sharp from "sharp";
import { writeFileSync } from "node:fs";

// 2026-07-27 (mockup-vs-live audit) — replaced the placeholder indigo→violet
// "F" monogram (#6366f1/#8b5cf6, colours in no Ticket·Calm token) with the
// real brand mark: the same two stacked, rotated cards `Logo.tsx` draws in
// the app itself (show-purple behind, accent-gold in front), on the app's
// own dark surface ground instead of a gradient. The mark is scaled to sit
// well inside the maskable safe zone (roughly the center 60%) so Android's
// adaptive-icon mask doesn't clip it.
const SVG = `<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" fill="#100E0C"/>
  <g transform="translate(256,256) scale(11) translate(-11.8,-14.1)">
    <rect x="0" y="5" width="18" height="20" rx="4" fill="#a78bfa" transform="rotate(-9 9 15)"/>
    <rect x="7" y="2" width="18" height="20" rx="4" fill="#C8A24B" stroke="#100E0C" stroke-width="1"/>
  </g>
</svg>`;

const buf = Buffer.from(SVG);
const targets = [
  [192, "public/icon-192.png"],
  [512, "public/icon-512.png"],
  [512, "public/icon-maskable-512.png"],
  [180, "src/app/apple-icon.png"], // Next app-icon convention → auto apple-touch-icon link
  [256, "src/app/icon.png"], // browser-tab favicon (PNG fallback for non-SVG browsers)
];

for (const [size, out] of targets) {
  await sharp(buf).resize(size, size).png().toFile(out);
  console.log(`wrote ${out} (${size}x${size})`);
}

// Scalable favicon — modern browsers prefer this over the PNG. Next links both
// (app/icon.svg + app/icon.png); the old default favicon.ico is removed.
writeFileSync("src/app/icon.svg", SVG);
console.log("wrote src/app/icon.svg");
