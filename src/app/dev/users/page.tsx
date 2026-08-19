import { notFound } from "next/navigation";
import { getSession } from "@/lib/session";
import { isScoringAdmin } from "@/lib/devAdmin";
import UsersDashboard from "./UsersDashboard";

// Same env user-ID allowlist gate as /dev/scoring and /dev/analytics. A
// non-admin (or a logged-out visitor) gets a plain 404.
export default async function DevUsersPage() {
  const session = await getSession();
  if (!session || !isScoringAdmin(session.userId)) notFound();
  return <UsersDashboard />;
}
