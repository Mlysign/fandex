// P14 — generate the PWA / app icons from one SVG (placeholder radar mark in the
// brand gradient, matching the OG image). Rasterized with sharp at the sizes a
// manifest + iOS need. Re-run after editing the SVG or swapping in real art:
//   node scripts/gen-icons.mjs
import sharp from "sharp";

// Full-bleed square (works as both a normal and a maskable icon): the gradient
// reaches every edge and the mark sits inside the maskable safe zone (center
// ~60%). A fanned deck of cards — a nod to Fandex (fan + dex): your collection of
// games/movies/shows. 512 viewBox; sharp scales to each target.
const SVG = `<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0a0a0a"/>
      <stop offset="1" stop-color="#312e81"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <g stroke="#1e1b4b" stroke-width="4">
    <rect x="198" y="175" width="116" height="176" rx="16" fill="#4f46e5" transform="rotate(-24 256 375)"/>
    <rect x="198" y="175" width="116" height="176" rx="16" fill="#818cf8" transform="rotate(0 256 375)"/>
    <rect x="198" y="175" width="116" height="176" rx="16" fill="#c7d2fe" transform="rotate(24 256 375)"/>
  </g>
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
