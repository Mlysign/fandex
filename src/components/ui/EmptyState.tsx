"use client";
import type { ReactNode } from "react";

// Shared <EmptyState> (T27/U5, restyled H1.6b — 03-components.md §14) — one
// consistent shape for "nothing here yet" and "nothing matched" states that
// were previously bespoke per page. Rich onboarding flows (dashboard
// first-run checklist) stay custom; this covers the common centered
// icon-tile + serif title + hint + optional actions, in an elevated panel.

interface EmptyStateProps {
  title: ReactNode;
  /** Secondary line under the title. */
  hint?: ReactNode;
  /** Buttons / links rendered in a centered row below the hint. */
  actions?: ReactNode;
  /** Decorative glyph/icon above the title — rendered in a 40px accent-subtle tile. */
  icon?: ReactNode;
  className?: string;
}

export default function EmptyState({ title, hint, actions, icon, className = "" }: EmptyStateProps) {
  return (
    <div className={`max-w-md mx-auto text-center py-12 px-6 bg-surface-elevated border border-border rounded-lg ${className}`}>
      {icon && (
        <div
          className="mx-auto mb-4 w-10 h-10 rounded-lg bg-accent-subtle text-accent flex items-center justify-center"
          aria-hidden
        >
          {icon}
        </div>
      )}
      <p className="font-serif text-serif-md text-text-primary mb-1.5">{title}</p>
      {hint && <p className="text-body-sm text-text-secondary leading-relaxed mb-5">{hint}</p>}
      {actions && <div className="flex gap-3 justify-center flex-wrap">{actions}</div>}
    </div>
  );
}
