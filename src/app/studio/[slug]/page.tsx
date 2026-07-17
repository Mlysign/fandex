import { buildFacetMetadata, FacetPageBody } from "@/components/facet/facetSsr";

// P17 — public studio facet page (folds film studios + game developers/publishers).
// See person/[slug] for the force-dynamic note.
export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;

export async function generateMetadata({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SP> }) {
  const { slug } = await params;
  return buildFacetMetadata("studio", slug, await searchParams);
}

export default async function Page({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SP> }) {
  const { slug } = await params;
  return <FacetPageBody prefix="studio" slug={slug} searchParams={await searchParams} />;
}
