import { notFound } from "next/navigation";
import { getSession } from "@/lib/session";
import { isScoringAdmin } from "@/lib/devAdmin";
import AnalyticsDashboard from "./AnalyticsDashboard";

// Same env user-ID allowlist gate as /dev/scoring. A non-admin (or a logged-out
// visitor) gets a plain 404 — this page's existence isn't something to advertise,
// and traffic totals are business data.
export default async function DevAnalyticsPage() {
  const session = await getSession();
  if (!session || !isScoringAdmin(session.userId)) notFound();
  return <AnalyticsDashboard />;
}
