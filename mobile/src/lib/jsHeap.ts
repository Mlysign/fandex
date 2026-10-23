// How big the JavaScript heap is, for the timing lines in logcat
// (`adb logcat -s ReactNativeJS`). Hermes answers in a release build too; a
// browser has no HermesInternal and gets null.

interface HermesStats { js_heapSize?: number; js_allocatedBytes?: number }

export function jsHeapMB(): { heapMB: number; usedMB: number } | null {
  const stats = (globalThis as { HermesInternal?: { getInstrumentedStats?: () => HermesStats } }).HermesInternal?.getInstrumentedStats?.();
  if (!stats?.js_heapSize) return null;
  return { heapMB: Math.round(stats.js_heapSize / 1e6), usedMB: Math.round((stats.js_allocatedBytes ?? 0) / 1e6) };
}
