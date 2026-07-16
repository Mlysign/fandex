import { redirect } from "next/navigation";
import { CATALOG } from "@/lib/sources/catalog";
import { anyItemHref, isPublicType } from "@/lib/publicUrl";

// P13 — `/item?id=…&type=…&tmdbId=…` is the LEGACY item url. The item page now
// lives at `/{type}/{id}/{slug}`: one url, shared by logged-out and logged-in
// viewers. This keeps every old link, bookmark and shared url working.
//
// Kept as a redirect rather than deleted: these urls are in the wild (they were
// what the app linked to for its whole life), and dropping them would 404 them.
export default async function LegacyItemRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  const id = one(sp.id);
  const type = one(sp.type);
  if (!id || !type || !isPublicType(type)) redirect("/dashboard");

  // Recover the source ids from their legacy param names (`tmdbId` → tmdb).
  const ids: Record<string, string> = {};
  for (const m of Object.values(CATALOG)) {
    const v = one(sp[m.urlParam]);
    if (v) ids[m.id] = v;
  }

  redirect(anyItemHref({ id, type, title: one(sp.title) ?? null, ids }));
}
