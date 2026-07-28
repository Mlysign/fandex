"use client";
import MyStuffView from "@/components/MyStuffView";

// C8 (2026-07-28) — /library and /wishlist now render one shared component
// (MyStuffView); the route decides only which tab opens initially. See
// MyStuffView.tsx for the merge + tab logic.
export default function LibraryPageClient() {
  return <MyStuffView route="library" initialTab="all" />;
}
