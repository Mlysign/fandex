"use client";
import { useEffect } from "react";
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

        <div className="flex justify-center gap-6 text-xs text-neutral-600 pt-2">
          <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-[#4ade80]" />Games</span>
          <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-[#f59e0b]" />Movies</span>
          <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-[#a78bfa]" />Shows</span>
        </div>
      </div>
    </main>
  );
}
