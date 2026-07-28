// SM19 (2026-07-28): the pure "how many items to render this page" arithmetic
// behind GroupedView's incremental reveal (/library renders its full ~2,000
// item set at once today — 44.5k DOM nodes, a 237ms-blocking keystroke).
// Extracted so the paging math is testable without a DOM or
// IntersectionObserver. Never exceeds `total` — a set smaller than
// `initialCount` renders in full immediately, with nothing left to grow.

export function initialVisibleCount(total: number, initialCount: number): number {
  return Math.min(total, initialCount);
}

export function growVisibleCount(current: number, total: number, step: number): number {
  return Math.min(total, current + step);
}
