// Where a card leads. A leaf with no imports but a type, so the website's
// server render (mobile/web/render.tsx) can use it without the app's router
// and database, which lib/cards.ts brings with it.

import type { CardItem } from '~/lib/cards';

/**
 * A catalog title's address: the public one, which the website serves and Share
 * hands out, so the address bar is the one to pass on. A title without a slug
 * (an old row) falls back to the id. Every link to a title goes through this;
 * the rows on Insights, Profile and Up next did not, and stayed on `/item/{id}`
 * after the cards moved (SM61).
 */
export function itemHref(item: { id: string; type: string; slug?: string | null }): string {
  return item.slug ? `/${item.type}/${item.slug}` : `/item/${item.id}`;
}

/** Where a card leads. A provider title goes through /open, which asks the Worker to find or fetch it. */
export function cardHref(item: CardItem): string {
  if (item.id) return itemHref({ id: item.id, type: item.type, slug: item.slug });
  return `/open/${item.source}/${item.type}/${item.sourceId}`;
}
