// Draws assets/images/notification-icon.png: Android's status-bar icon for a
// reminder (2026-11-21). Android paints a notification icon as a white
// silhouette and ignores its colours, so the app icon would show as a blank
// square. This is the same mark as android-icon-foreground.svg (two cards, the
// front one outlined), in white on transparent, the outline a gap.
//
//   node scripts/gen-notification-icon.mjs   (from mobile/)

import fs from 'node:fs';
import { PNG } from 'pngjs';

const SIZE = 96;
const SAMPLES = 4; // per axis, for smooth edges

// The mark in its own units (android-icon-foreground.svg, inside the transforms).
const BACK = { x: 0, y: 5, w: 18, h: 20, r: 4, rotate: -9, cx: 9, cy: 15 };
const FRONT = { x: 7, y: 2, w: 18, h: 20, r: 4 };
const GAP = 0.5; // half the front card's 1-unit outline, either side of its edge
// The mark's extent with the rotation, padded a little, mapped onto the canvas.
const MIN_X = -4.2, MIN_Y = -1.6, SPAN = 32;

function inRoundRect(px, py, { x, y, w, h, r }, grow = 0) {
  const x0 = x - grow, y0 = y - grow, x1 = x + w + grow, y1 = y + h + grow, rr = Math.max(0, r + grow);
  if (px < x0 || px > x1 || py < y0 || py > y1) return false;
  const cx = Math.min(Math.max(px, x0 + rr), x1 - rr);
  const cy = Math.min(Math.max(py, y0 + rr), y1 - rr);
  return (px - cx) ** 2 + (py - cy) ** 2 <= rr * rr;
}

function inBack(px, py) {
  // Undo the card's rotation about its centre, then test the plain rectangle.
  const a = (-BACK.rotate * Math.PI) / 180;
  const dx = px - BACK.cx, dy = py - BACK.cy;
  return inRoundRect(BACK.cx + dx * Math.cos(a) - dy * Math.sin(a), BACK.cy + dx * Math.sin(a) + dy * Math.cos(a), BACK);
}

const white = (px, py) => inRoundRect(px, py, FRONT, -GAP) || (inBack(px, py) && !inRoundRect(px, py, FRONT, GAP));

const png = new PNG({ width: SIZE, height: SIZE });
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let hit = 0;
    for (let sy = 0; sy < SAMPLES; sy++) {
      for (let sx = 0; sx < SAMPLES; sx++) {
        const px = MIN_X + ((x + (sx + 0.5) / SAMPLES) / SIZE) * SPAN;
        const py = MIN_Y + ((y + (sy + 0.5) / SAMPLES) / SIZE) * SPAN;
        if (white(px, py)) hit++;
      }
    }
    const i = (y * SIZE + x) * 4;
    png.data[i] = png.data[i + 1] = png.data[i + 2] = 255;
    png.data[i + 3] = Math.round((hit / (SAMPLES * SAMPLES)) * 255);
  }
}
fs.writeFileSync(new URL('../assets/images/notification-icon.png', import.meta.url), PNG.sync.write(png));
console.log('wrote assets/images/notification-icon.png');
