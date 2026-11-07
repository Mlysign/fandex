// What a tap on the type filter's circles saves (lib/typeFilter.tsx). Pure, so
// it is tested without a device.
//
// "No pick" (an empty list) means the account's default types, the ones turned
// on in Settings. A pick that lands back on exactly those is stored as no pick,
// so the row reads "your types" again. A pick that covers every type the row
// offers, when the default does not, is stored as every type: storing it as no
// pick would quietly hide again the type just switched on (Nils, 2026-11-07:
// closing the row turned every type on and never went back to the settings).

import { MEDIA_TYPES, enabledMediaTypes } from '@/lib/mediaTypes';

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((t) => b.includes(t));

/** What to store for the types a tap left on. */
export function settlePick(next: readonly string[], offered: readonly string[], stored: readonly string[] | null | undefined): string[] {
  const on = offered.filter((t) => next.includes(t));
  if (!on.length) return [];
  const defaults = offered.filter((t) => enabledMediaTypes(stored).includes(t as never));
  if (sameSet(on, defaults)) return [];
  if (on.length === offered.length) return [...MEDIA_TYPES];
  return on;
}

/**
 * One tap on a type's circle. When the row shows every type (and that is the
 * default), a tap narrows to that type alone. Otherwise a tap adds a type that
 * is off or drops one that is on.
 */
export function tapPick(type: string, shown: readonly string[], offered: readonly string[], stored: readonly string[] | null | undefined, atDefault: boolean): string[] {
  const on = offered.filter((t) => shown.includes(t));
  if (on.length >= offered.length && atDefault) return settlePick([type], offered, stored);
  return settlePick(on.includes(type) ? on.filter((t) => t !== type) : [...on, type], offered, stored);
}

/** A long press: hide this one type, keep what else is showing. Hiding the last one goes back to the default. */
export function excludePick(type: string, shown: readonly string[], offered: readonly string[], stored: readonly string[] | null | undefined): string[] {
  return settlePick(offered.filter((t) => shown.includes(t) && t !== type), offered, stored);
}
