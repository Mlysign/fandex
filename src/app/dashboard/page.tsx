import { permanentRedirect } from "next/navigation";

// H1.6c — /dashboard was the wishlist page; the IA restructure moved it to
// /wishlist. This is a permanent (308) redirect so old links, bookmarks, and
// the historical post-login target keep working. Server component: the
// redirect happens before any client JS.
export default function DashboardRedirect() {
  permanentRedirect("/wishlist");
}
