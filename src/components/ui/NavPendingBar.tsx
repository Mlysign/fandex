"use client";
import { useLinkStatus } from "next/link";

// NavPendingBar — an indeterminate progress line for a <Link> whose destination
// is slow to arrive.
//
// WHY (Nils, 2026-08-14, mobile testing): "the facets on the insights page
// don't have tap feedback. I tapped 'roguelite' and thought nothing happened —
// the new page just took a while to load." Both halves of that are real and
// they need different fixes:
//
//   1. No PRESS feedback. Every facet row styled its response as `hover:`, and
//      a touch device has no hover — so the tap itself was silent. That half is
//      fixed at the call site with an `active:` state, which fires on touch.
//   2. No PENDING feedback. /tag/* and friends are `force-dynamic` with a
//      provider fan-out behind them; even warm off the L2 cache the transition
//      is visible, and cold it is seconds. Nothing on screen said "on its way".
//
// This component covers (2). It must be rendered INSIDE the <Link> it reports
// on — that's how useLinkStatus finds it — and it is deliberately absolutely
// positioned and always mounted, so switching it on can't shift the row's
// layout (the hook's own docs warn about exactly that).
//
// Note it goes quiet by itself: `pending` is false whenever the route was
// already prefetched, so a fast/cached destination shows nothing at all rather
// than a flash of progress bar.
export default function NavPendingBar({ className = "" }: { className?: string }) {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden
      /* duration-[var(--duration-fast)], not `duration-fast` — Tailwind v4 has
         no `--duration-*` namespace, so the token-named utility generates no
         rule. See SubBar.tsx for the same note. */
      className={`pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden transition-opacity duration-[var(--duration-fast)] ${
        pending ? "opacity-100" : "opacity-0"
      } ${className}`}
    >
      <span
        className="block h-full w-1/3 rounded-full bg-accent motion-safe:animate-[nav-pending_1.1s_ease-in-out_infinite] motion-reduce:w-full motion-reduce:opacity-60"
      />
    </span>
  );
}
