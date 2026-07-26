"use client";
import { Search, X } from "lucide-react";

// The <SearchField> primitive (03-components.md §8), shared across Discover,
// Wishlist and Library (rendered inside SubBar). The richer filters — type,
// source, must-include/exclude facets, hide-rated — live in SubBar's
// always-visible filter section, not here, so every page presents the same
// controls in one place.

interface SearchBarProps {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
}

export default function SearchBar({ value, onChange, placeholder = "Search…" }: SearchBarProps) {
  return (
    <div className="relative flex-1">
      <Search
        aria-hidden
        className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary pointer-events-none"
      />
      <input
        type="search"
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full h-11 bg-surface-elevated border border-border rounded-lg pl-10 pr-11 text-body text-text-primary placeholder-text-secondary focus:outline-none focus:border-accent/45 transition-colors [&::-webkit-search-cancel-button]:hidden"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") onChange(""); }}
      />
      {value && (
        // H1.6f a11y: the glyph stays 16px, but the BUTTON is now a full
        // 44×44 hit box (06-accessibility.md explicitly allows a smaller
        // visible glyph with a padded hit area). It measured 16×16 before —
        // the smallest tap target in the app, on a high-traffic control.
        // The input's right padding grew to match so text can't run under it.
        <button
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute right-0 top-1/2 -translate-y-1/2 w-11 h-11 inline-flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors"
        >
          <X className="w-4 h-4" aria-hidden />
        </button>
      )}
    </div>
  );
}
