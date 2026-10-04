// The Up next home-screen widget, from the app's side.
//
// The widget itself is Kotlin (modules/up-next-widget). It reads the `up_next`
// table this app writes, so all the app has to do is say when that table has
// changed. On the web, and in any build without the native module, every call
// here does nothing.

import { requireOptionalNativeModule } from 'expo';

interface UpNextWidgetNative {
  refresh(): void;
  placed(): number;
  requestPin(): boolean;
}

const native = requireOptionalNativeModule<UpNextWidgetNative>('UpNextWidget');

export const widgetAvailable = native != null;

/** The `up_next` table changed: have every placed widget read it again. Never throws. */
export function refreshWidget(): void {
  try { native?.refresh(); } catch { /* A widget that did not refresh is not worth failing a sync over. */ }
}

/** How many Up next widgets are on the home screen. */
export function widgetsPlaced(): number {
  try { return native?.placed() ?? 0; } catch { return 0; }
}

/** Ask the launcher to add the widget. False when the launcher cannot; it is then added from the launcher's own widget list. */
export function requestWidget(): boolean {
  try { return native?.requestPin() ?? false; } catch { return false; }
}
