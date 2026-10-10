// The item page on a wide window: the site's two columns (src/components/item/
// ItemView.tsx). Artwork on the left, 380 px and sticky; the title, dates,
// scores, synopsis and facts on the right; trailer, cast, tags and links in a
// full-width band underneath. All inside the site's 1152 px container.
//
// It is CSS, keyed on `data-item` attributes, and not a width check in the
// component. A static page has no script to measure a window with, and it is
// the static page a visitor and a crawler get. The same rules are put into the
// app's own document, so both draw the same thing. On a phone none of this
// exists and the page is its one column.
//
// ⚠️ The two columns are their own box (`columns`), inside the page's container
// (`grid`), with the full-width band after them. A sticky element stays stuck
// for as long as its parent lasts. When the band was a third child of one grid,
// the artwork stayed stuck down the whole page and sat under the trailer and
// the cast. Chrome does not stop a sticky grid item at the end of its own row.

import { useEffect } from 'react';
import { Platform } from 'react-native';

/** The attribute a part of the page carries, as props for a View. */
// `dataSet` is how react-native-web takes a data attribute in a browser. A bare
// `data-item` prop came through when rendering on a server and was dropped in
// the running app, so the page was two columns as a file and one in the app.
export const part = (name: string) => ({ dataSet: { item: name } }) as object;

export const ITEM_PAGE_CSS = `
[data-item="title-wide"]{display:none}
@media (min-width:1024px){
[data-item="grid"]{width:100%;max-width:1152px;margin:0 auto;padding:24px;box-sizing:border-box}
[data-item="columns"]{display:grid!important;grid-template-columns:minmax(0,380px) minmax(0,1fr);column-gap:40px;align-items:start}
[data-item="hero"]{position:sticky!important;top:24px;border-radius:20px;border:1px solid rgba(237,231,220,0.09);max-height:520px!important}
[data-item="hero-scrim"],[data-item="hero-title"]{display:none!important}
[data-item="hero-text"]{padding:0 0 12px!important;align-items:center}
[data-item="title-wide"]{display:flex!important}
[data-item="upper"]{padding:0!important}
[data-item="lower"]{padding-left:0!important;padding-right:0!important}
[data-item="prose"]{max-width:68ch}
}`;

const STYLE_ID = 'fandex-item-layout';

/** Put the rules into the document, once. Only a browser has one. */
export function useItemPageCss(): void {
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const doc = globalThis.document;
    if (!doc || doc.getElementById(STYLE_ID)) return;
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = ITEM_PAGE_CSS;
    doc.head.appendChild(style);
  }, []);
}
