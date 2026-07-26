"use client";

// Shared loading indicator (T27/U5, restyled H1.6b) — replaces the ad-hoc
// plain "Loading…" / `animate-pulse` text on the calendar view and /foryou,
// so loading reads the same everywhere skeletons don't fit (calendar grid,
// swipe feed). Spin collapses under the global reduced-motion rule.
export default function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-text-secondary" role="status" aria-live="polite">
      <span
        aria-hidden
        className="w-6 h-6 rounded-full border-2 border-border-strong border-t-accent animate-spin"
      />
      {label && <span className="text-body-sm">{label}</span>}
    </div>
  );
}
