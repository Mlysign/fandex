import { buildFacetMetadata, FacetPageBody } from "@/components/facet/facetSsr";

// P17 — public person facet page. force-dynamic: it does live provider calls +
// thin-persists rows (a DB write), so it must never be statically cached.
export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;

export async function generateMetadata({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SP> }) {
  const { slug } = await params;
  return buildFacetMetadata("person", slug, await searchParams);
}

export default async function Page({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SP> }) {
  const { slug } = await params;
  return <FacetPageBody prefix="person" slug={slug} searchParams={await searchParams} />;
}
