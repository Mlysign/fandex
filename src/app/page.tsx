"use client";
import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Logo from "@/components/Logo";
import AuthOptions from "@/components/auth/AuthOptions";

export default function LoginPage() {
  const router = useRouter();

  useEffect(() => {
    // Redirect if already logged in
    fetch("/api/auth/me").then((r) => r.json()).then((d) => {
      if (d.user) router.push("/dashboard");
    });
  }, []);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4">
      <div className="max-w-sm w-full space-y-8 text-center">
        <div>
          <Logo size={56} className="mx-auto mb-4" />
          <h1 className="text-4xl font-bold mb-2">Fandex</h1>
          <p className="text-neutral-400">Track your wishlists, discover what you&apos;ll love, and see what&apos;s coming — games, movies &amp; shows, all in one place.</p>
        </div>

        <AuthOptions />

        {/* Q2 — the catalog is public (H2b): give visitors a way in without an
            account instead of a login-only dead end. */}
        <div className="space-y-4">
          <div className="flex items-center gap-3 text-xs text-neutral-600">
            <span className="flex-1 h-px bg-neutral-800" />
            or
            <span className="flex-1 h-px bg-neutral-800" />
          </div>
          <Link
            href="/discover"
            className="block w-full py-3 rounded-xl font-medium border border-neutral-700 text-neutral-300 hover:text-white hover:border-neutral-500 hover:bg-neutral-900 transition-all"
          >
            Browse without an account →
          </Link>
        </div>

        <div className="flex justify-center gap-6 text-xs text-neutral-600 pt-2">
          <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-[#4ade80]" />Games</span>
          <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-[#f59e0b]" />Movies</span>
          <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-[#a78bfa]" />Shows</span>
        </div>
      </div>
    </main>
  );
}
