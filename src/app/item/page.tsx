import { redirect } from "next/navigation";
import { CATALOG } from "@/lib/sources/catalog";
import { isPublicType, isUuid, publicItemHref } from "@/lib/publicUrl";
import { findItemBySourceId, loadPublicItemRow } from "@/lib/detail/publicDetail";

// P13 — `/item?id=…&type=…&tmdbId=…` is the LEGACY item url. The item page now
// lives at `/{type}/{id}/{slug}`: one url, shared by logged-out and logged-in
// viewers. This keeps every old link, bookmark and shared url working.
//
// Kept as a redirect rather than deleted: these urls are in the wild (they were
// what the app linked to for its whole life), and dropping them would 404 them.
//
// H2b — this used to hand the ids straight to anyItemHref, which would mint a
// `/{type}/tmdb-693134/{slug}` url and let the item page resolve it live. That
// form is gone, so the ids are resolved HERE, against the DB, into the item's
// uuid. An id we've never stored no longer has a page to send anyone to.
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

  // The legacy id was already a uuid for library/wishlist items — the common case.
  if (isUuid(id)) {
    const row = loadPublicItemRow(id);
    if (row) redirect(publicItemHref(row));
    redirect("/dashboard");
  }

  // Otherwise recover the source ids from their legacy param names (`tmdbId` →
  // tmdb) and look the item up by any of them.
  for (const m of Object.values(CATALOG)) {
    const v = one(sp[m.urlParam]);
    if (!v) continue;
    const row = findItemBySourceId(m.id, v);
    if (row) redirect(publicItemHref(row));
  }

  redirect("/dashboard");
}
