"use client";
import { useEffect } from "react";

// Q8 — these pages are auth-gated client components (no SSR data worth a
// generateMetadata split, and anon visitors never see them), so the layout's
// `<title>` template can't reach them. Set the tab title client-side instead,
// matching the same "X · Fandex" shape the template produces for SSR pages.
export function usePageTitle(title: string) {
  useEffect(() => {
    const prev = document.title;
    document.title = `${title} · Fandex`;
    return () => { document.title = prev; };
  }, [title]);
}
