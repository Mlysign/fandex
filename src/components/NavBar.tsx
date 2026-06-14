"use client";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";

const NAV_LINKS = [
  { href: "/discover",   label: "Discover" },
  { href: "/foryou",     label: "For You" },
  { href: "/dashboard",  label: "Wishlist" },
  { href: "/library",    label: "Library" },
  { href: "/insights",   label: "Insights" },
  { href: "/settings",   label: "Profile" },
];

export default function NavBar() {
  const router   = useRouter();
  const pathname = usePathname();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
  }

  return (
    <nav className="border-b border-neutral-800 px-6 py-0 flex items-center justify-between sticky top-0 bg-neutral-950 z-30 h-14">
      <span className="font-bold text-base tracking-tight">ReleaseRadar</span>

      <div className="flex items-center gap-1">
        {NAV_LINKS.map(({ href, label }) => {
          const active = pathname === href || (href !== "/" && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                active
                  ? "bg-neutral-800 text-white font-medium"
                  : "text-neutral-400 hover:text-white hover:bg-neutral-900"
              }`}
            >
              {label}
            </Link>
          );
        })}
        <div className="w-px h-4 bg-neutral-800 mx-1" />
        <button
          onClick={logout}
          className="px-3 py-1.5 rounded-lg text-sm text-neutral-500 hover:text-white hover:bg-neutral-900 transition-colors"
        >
          Log out
        </button>
      </div>
    </nav>
  );
}
