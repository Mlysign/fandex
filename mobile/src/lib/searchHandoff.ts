// A query typed somewhere else, for Search to pick up. The nav bar's search box
// hands the text over on Enter (components/NavSearch.tsx), as the site's did by
// seeding `rr_discover_q`. Search is a tab that stays mounted, so it listens;
// one that mounts later reads what is waiting.

let waiting: string | null = null;
const listeners = new Set<(q: string) => void>();

export function handSearchQuery(q: string): void {
  if (listeners.size) for (const l of listeners) l(q);
  else waiting = q;
}

/** What was handed over before Search mounted, once. */
export function takeWaitingQuery(): string | null {
  const q = waiting;
  waiting = null;
  return q;
}

export function onSearchQuery(listener: (q: string) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
