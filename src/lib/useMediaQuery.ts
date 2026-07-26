"use client";
import { useEffect, useState } from "react";

// SSR-safe breakpoint check. Starts `false` on every render (server AND the
// client's first paint) so hydration never mismatches, then corrects itself
// once in an effect after mount — the standard-safe two-pass pattern for
// this problem. Consumers that need a single instance of stateful content to
// live in exactly one of two responsive locations (not duplicated across
// both, see FilterPanel's Sheet conversion) should branch render location on
// this value rather than on CSS visibility.
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(query);
    // Reading the real value can only happen after mount, so this
    // measure-then-setState is a necessary effect, not derivable at render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMatches(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
