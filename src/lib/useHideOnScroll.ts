"use client";
import { useEffect, useRef, useState } from "react";

// useHideOnScroll — "get out of the way going down, come back the instant I go
// up" (Nils, 2026-08-14, mobile testing): the list pages' filter/search header
// ate a third of a phone screen permanently, and a plain `sticky` header is
// either always there or only returns once you scroll all the way to the top.
// Neither is what a reader wants.
//
// THE RULE, and why each half of it is asymmetric:
//   • Scrolling DOWN hides — but only past `offset`, so the header doesn't
//     flicker away during the first few pixels of a nudge near the top.
//   • Scrolling UP shows — immediately, with a much smaller threshold, because
//     an upward flick IS the request to see the controls again. Making this
//     symmetric is what makes these headers feel sticky-but-stubborn.
//   • At the very top the header is always shown, regardless of direction.
//
// The two thresholds are deliberately different sizes. `UP_EPS` exists only to
// swallow sub-pixel jitter and iOS rubber-banding; `DOWN_EPS` is large enough
// that a slow, deliberate downward drag doesn't strobe the header on and off.
const UP_EPS = 4;
const DOWN_EPS = 8;

export function useHideOnScroll(offset = 64): boolean {
  const [hidden, setHidden] = useState(false);
  // Last position we ACTED on, not last position seen — comparing against the
  // previous frame's scrollY makes every threshold effectively zero, since a
  // smooth scroll delivers 1-2px deltas and both epsilons would always pass.
  const anchor = useRef(0);

  useEffect(() => {
    anchor.current = window.scrollY;

    // rAF-throttled: scroll fires far more often than the browser paints, and
    // this only ever results in a class flip.
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const y = window.scrollY;
        const delta = y - anchor.current;

        if (y <= offset) {
          anchor.current = y;
          setHidden(false);
          return;
        }
        if (delta < -UP_EPS) {
          anchor.current = y;
          setHidden(false);
        } else if (delta > DOWN_EPS) {
          anchor.current = y;
          setHidden(true);
        }
        // Inside the deadband: leave both the anchor and the state alone, so
        // small movements accumulate toward a threshold instead of being lost.
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [offset]);

  return hidden;
}
