// The Up next home-screen widget, from the app's side.
//
// The widget itself is Kotlin (modules/up-next-widget). It shows the rows the
// app hands it and nothing else, so all the app has to do is hand them over
// whenever the `up_next` table changes. On the web, and in any build without
// the native module, every call here does nothing.
//
// The widget does NOT read the app's SQLite file. Android's SQLite and the one
// expo-sqlite ships are two copies of the library, and two copies on one file
// in one process do not see each other's locks.

import { requireOptionalNativeModule } from 'expo';
import type { SQLiteDatabase } from 'expo-sqlite';

interface UpNextWidgetNative {
  setRows(json: string): void;
  placed(): number;
  requestPin(): boolean;
}

const native = requireOptionalNativeModule<UpNextWidgetNative>('UpNextWidget');

export const widgetAvailable = native != null;

/** How many rows the widget is given. It shows three or four and scrolls. */
const WIDGET_ROWS = 12;

/**
 * Hand the widget its rows, read from `up_next`. The same query and order as
 * the Up next tab (upNext.ts → upNextList), kept here so this file imports
 * nothing that imports it back. ⚠️ The ORDER BY is the same expression in both
 * and has to stay so: it counts this device's own record of your last tick,
 * because Trakt's `last_watched_at` lags a tick made seconds earlier and a
 * show ticked again and again stayed below one ticked before it. Never throws: a widget that did not redraw is
 * not worth failing a sync over.
 */
export async function publishWidget(db: SQLiteDatabase): Promise<void> {
  if (!native) return;
  try {
    const rows = await db.getAllAsync<{ id: string; title: string; season: number; episode: number; episodeTitle: string | null; posterUrl: string | null }>(
      `SELECT u.media_item_id AS id, c.title, u.season, u.episode, u.title AS episodeTitle, c.poster_url AS posterUrl
         FROM up_next u JOIN catalog c ON c.id = u.media_item_id
        WHERE u.season IS NOT NULL
          AND u.media_item_id NOT IN (SELECT media_item_id FROM hidden_item)
        ORDER BY MAX(COALESCE(u.last_watched_at, 0), COALESCE(u.aired_at, 0), COALESCE((SELECT MAX(e.watched_at) FROM episode_state e WHERE e.media_item_id = u.media_item_id), 0)) DESC, c.title
        LIMIT ?`,
      [WIDGET_ROWS],
    );
    native.setRows(JSON.stringify(rows));
  } catch (e) {
    console.warn('widget_rows_failed', e instanceof Error ? e.message : String(e));
  }
}

/** How many Up next widgets are on the home screen. */
export function widgetsPlaced(): number {
  try { return native?.placed() ?? 0; } catch { return 0; }
}

/** Ask the launcher to add the widget. False when the launcher cannot; it is then added from the launcher's own widget list. */
export function requestWidget(): boolean {
  try { return native?.requestPin() ?? false; } catch { return false; }
}
