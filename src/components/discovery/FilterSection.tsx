"use client";
import type { ReactNode } from "react";

// One labelled block in the Filters sheet (Option A, 2026-08-27).
//
// The panel used to be a single wrapping flex row, which is what made it look
// broken: the three membership toggles broke the line, and the include/exclude
// autocompletes broke it again the moment they held a chip. Sections stack, so
// nothing wraps and the eyebrow tells you what each control is for.
export default function FilterSection({
  label, hint, children,
}: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <h4 className="font-mono text-eyebrow uppercase text-text-secondary">{label}</h4>
        {hint && <span className="font-mono text-meta text-text-muted">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

/** Hairline between sections. A plain element so the sheet body stays one flex column. */
export function FilterDivider() {
  return <div className="h-px bg-border" aria-hidden />;
}
