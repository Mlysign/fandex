"use client";

// H1.6f — reduced-motion-aware scroll behavior.
//
// globals.css sets `scroll-behavior: auto !important` under
// `prefers-reduced-motion: reduce`, but that ONLY governs the CSS property.
// An explicit `behavior: "smooth"` passed to scrollIntoView()/scrollBy()
// takes precedence over it, so every JS-driven smooth scroll silently
// escaped the global rule (the month scrubber and the Rail chevrons).
//
// Read at CALL time, not via a hook: these are all invoked from click
// handlers, so there's no render-time value to track and no state needed.
export function scrollBehavior(): ScrollBehavior {
  if (typeof window === "undefined" || !window.matchMedia) return "smooth";
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}
