"use client";
import { ReactNode } from "react";
import { TriangleAlert, RefreshCw, RotateCw } from "lucide-react";
import Button from "@/components/ui/Button";

// <ErrorState> — 03-components.md §15, NEW (several pages have no error
// state today — see docs/ui-overhaul.md §4/H1.6f). Same frame as EmptyState
// but a danger-tinted icon tile and a "Try again" retry — never a dead end.

interface ErrorStateProps {
  title?: ReactNode;
  hint?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

export default function ErrorState({
  title = "Something went wrong",
  hint = "Try again in a moment.",
  onRetry,
  retryLabel = "Try again",
  className = "",
}: ErrorStateProps) {
  return (
    <div className={`max-w-md mx-auto text-center py-12 px-6 bg-surface-elevated border border-border rounded-lg ${className}`}>
      <div className="mx-auto mb-4 w-10 h-10 rounded-lg bg-danger-subtle text-danger flex items-center justify-center" aria-hidden>
        <TriangleAlert className="w-5 h-5" />
      </div>
      <p className="font-serif text-serif-md text-text-primary mb-1.5">{title}</p>
      {hint && <p className="text-body-sm text-text-secondary leading-relaxed mb-5">{hint}</p>}
      {onRetry && (
        <Button variant="secondary" size="md" onClick={onRetry}>
          <RefreshCw className="w-4 h-4" aria-hidden />
          {retryLabel}
        </Button>
      )}
    </div>
  );
}

// Compact one-line variant for inline/per-rail errors (§15: "Inline (per-rail)
// errors use a compact one-line variant with a RotateCw retry").
export function InlineErrorState({ message = "Couldn't load this", onRetry }: { message?: ReactNode; onRetry?: () => void }) {
  return (
    <div className="flex items-center gap-2 text-body-sm text-text-secondary py-3">
      <TriangleAlert className="w-3.5 h-3.5 text-danger shrink-0" aria-hidden />
      <span className="flex-1">{message}</span>
      {onRetry && (
        <button onClick={onRetry} aria-label="Retry" className="text-text-secondary hover:text-text-primary p-1 -m-1">
          <RotateCw className="w-3.5 h-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}
