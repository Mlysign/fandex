import { notFound, permanentRedirect } from "next/navigation";
import { isPublicType, isUuid } from "@/lib/publicUrl";
import { loadPublicItemRow } from "@/lib/detail/publicDetail";

// The OLD item url, `/{type}/{uuid}/{cosmetic-slug}`, kept alive forever as a
// redirect to `/{type}/{slug}` (2026-08-21). Every link shared before that
// change — every unfurl card, every crawler index entry — points here.
//
// The segment names read oddly and cannot be helped: Next requires sibling
// dynamic segments at the same depth to share ONE name, and level 2 is `[slug]`
// for the real page. So here `slug` holds the uuid and `legacy` holds the
// cosmetic slug that used to trail it. Both are read only in order to redirect.
//
// This deliberately does NOT render. Two urls both serving one item is how you
// split your own ranking signals, which is what the canonical tag on the old
// page was patching over. One address, one page, a permanent redirect to it.
interface Params {
  type: string;
  slug: string;
  legacy: string;
}

export default async function LegacyItemUrl({ params }: { params: Promise<Params> }) {
  const { type, slug: id } = await params;
  if (!isPublicType(type) || !isUuid(id)) notFound();

  const row = loadPublicItemRow(id);
  // A uuid with no row is a dead url — most often a browsed-only item the boot
  // prune removed, which is the churn this whole change exists to stop. 404 is
  // the right answer: there is nothing to redirect TO.
  if (!row || row.type !== type || !row.slug) notFound();

  permanentRedirect(`/${type}/${row.slug}`);
}
