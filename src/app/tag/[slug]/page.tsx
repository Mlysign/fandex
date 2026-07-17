import { buildFacetMetadata, FacetPageBody } from "@/components/facet/facetSsr";

// P17 — public tag/genre facet page. See person/[slug] for the force-dynamic note.
export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;

export async function generateMetadata({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SP> }) {
  const { slug } = await params;
  return buildFacetMetadata("tag", slug, await searchParams);
}

export default async function Page({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SP> }) {
  const { slug } = await params;
  return <FacetPageBody prefix="tag" slug={slug} searchParams={await searchParams} />;
}
