"use client";
import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  /** Optional label shown in the error card, e.g. "calendar" */
  label?: string;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="rounded-xl border border-red-900/40 bg-red-950/20 px-5 py-4 text-sm text-red-400 space-y-2">
          <p className="font-medium">
            Something went wrong{this.props.label ? ` in the ${this.props.label}` : ""}.
          </p>
          <p className="text-red-500/70 font-mono text-xs break-all">
            {this.state.error.message}
          </p>
          <button
            className="text-xs text-red-400 underline hover:text-red-300"
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/** Inline skeleton bar — use for loading states */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded bg-neutral-800 ${className}`} />
  );
}

/** Full-height loading skeleton for the list view */
export function ListSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-3">
          <Skeleton className="w-16 h-10 flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-48" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-5 w-14 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/** Grid loading skeleton for the card view */
export function CardSkeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="rounded-xl overflow-hidden border border-neutral-800 bg-neutral-900">
          <div className="animate-pulse bg-neutral-800 w-full" style={{ paddingBottom: "56.25%" }} />
          <div className="p-3 space-y-2">
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}
