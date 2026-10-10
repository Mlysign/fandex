// The website's static pages, seen from the app that takes over from them.
//
// A page the daily build wrote (mobile/web/build.mjs) carries its content in
// <div id="prerender">, laid over the empty #root the app renders into. The
// app starts underneath it. When the app has drawn the same thing, it removes
// the static copy, so the swap is one frame and not a blank screen while the
// fonts load and the database opens. If the app never gets that far, the
// static page simply stays, and it is a complete page.
//
// Two kinds of static copy:
//   data-page="item"   an item page. Only the item screen may remove it, once
//                      it has the item on screen.
//   anything else      a placeholder (the home page's). Removed as soon as the
//                      app is up.

import { Platform } from 'react-native';

/** The scrolling element of the item page, in the static copy and in the app. */
export const ITEM_SCROLL_ID = 'item-scroll';

function staticCopy(): HTMLElement | null {
  if (Platform.OS !== 'web') return null;
  return globalThis.document?.getElementById('prerender') ?? null;
}

/** Remove a placeholder. An item page's static copy is left for the item screen. */
export function dropPlaceholder(): void {
  const el = staticCopy();
  if (el && el.dataset.page !== 'item') el.remove();
}

/**
 * Remove an item page's static copy, keeping the reader where they were: the
 * app's page is scrolled to wherever the static one had been scrolled to.
 */
export function dropItemPrerender(): void {
  const el = staticCopy();
  if (!el) return;
  const selector = `[data-testid="${ITEM_SCROLL_ID}"]`;
  const top = el.querySelector<HTMLElement>(selector)?.scrollTop ?? 0;
  el.remove();
  if (top > 0) {
    const mine = globalThis.document.querySelector<HTMLElement>(`#root ${selector}`);
    if (mine) mine.scrollTop = top;
  }
}
