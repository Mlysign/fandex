import { useEffect, useState } from "react";

// SM19 (2026-07-28): /library's search box re-filters + re-renders its whole
// (potentially ~2,000-item) list on every keystroke — 237ms for the first
// character, 1,426ms clearing the box back to empty. A debounced VALUE, not a
// debounced callback: the input itself stays a normal controlled value (typed
// characters appear instantly), and consumers read this delayed copy for
// anything expensive (filtering, re-rendering a large list) instead.
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
