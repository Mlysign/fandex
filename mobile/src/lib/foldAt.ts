// Settings → Your platforms folds each group after two rows of chips (settings.tsx).

/**
 * Where a folded group ends: two rows of chips, measured, as the site did. Each
 * chip reports where it landed; the first one on a third row is the cut. Null
 * while that is not known yet (the first pass draws them all and measures).
 */
export function foldAt(tops: number[]): number | null {
  const rows = [...new Set(tops.map((t) => Math.round(t)))].sort((a, b) => a - b);
  if (rows.length <= 2) return null;
  const third = rows[2];
  const i = tops.findIndex((t) => Math.round(t) >= third);
  return i < 0 ? null : i;
}
