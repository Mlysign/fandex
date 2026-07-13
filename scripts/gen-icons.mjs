// P14 — generate the PWA / app icons from one SVG (placeholder radar mark in the
// brand gradient, matching the OG image). Rasterized with sharp at the sizes a
// manifest + iOS need. Re-run after editing the SVG or swapping in real art:
//   node scripts/gen-icons.mjs
import sharp from "sharp";

// Full-bleed square (works as both a normal and a maskable icon): the gradient
// reaches every edge and the radar mark sits well inside the maskable safe zone
// (center ~60%). 512 viewBox; sharp scales to each target.
const SVG = `<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0a0a0a"/>
      <stop offset="1" stop-color="#312e81"/>
    </linearGradient>
    <radialGradient id="sweep" cx="256" cy="256" r="160" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#a5b4fc" stop-opacity="0.85"/>
      <stop offset="1" stop-color="#a5b4fc" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <g fill="none" stroke="#a5b4fc" stroke-opacity="0.5" stroke-width="8">
    <circle cx="256" cy="256" r="60"/>
    <circle cx="256" cy="256" r="110"/>
    <circle cx="256" cy="256" r="160"/>
  </g>
  <path d="M256 256 L256 96 A160 160 0 0 1 369 143 Z" fill="url(#sweep)"/>
  <line x1="256" y1="256" x2="369" y2="143" stroke="#c7d2fe" stroke-width="10" stroke-linecap="round"/>
  <circle cx="256" cy="256" r="14" fill="#c7d2fe"/>
  <circle cx="335" cy="175" r="15" fill="#e0e7ff"/>
</svg>`;

const buf = Buffer.from(SVG);
const targets = [
  [192, "public/icon-192.png"],
  [512, "public/icon-512.png"],
  [512, "public/icon-maskable-512.png"],
  [180, "src/app/apple-icon.png"], // Next app-icon convention → auto apple-touch-icon link
];

for (const [size, out] of targets) {
  await sharp(buf).resize(size, size).png().toFile(out);
  console.log(`wrote ${out} (${size}x${size})`);
}
