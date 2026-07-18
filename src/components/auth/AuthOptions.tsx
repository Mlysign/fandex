"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { resetSessionProbe } from "@/lib/sessionProbe";

// The sign-in provider options — Trakt, Steam, RAWG — factored out of the login
// page (src/app/page.tsx) so the H2c in-page SignInDialog renders the EXACT same
// options and the two can't drift.
//
// Two contexts, one component:
//  • Login page: no props. Redirect providers go to /dashboard (or their return
//    cookie); RAWG posts and router.push()es to the returned redirect.
//  • SignInDialog (login-with-intent): `returnTo` is appended to the redirect
//    providers so the OAuth callback lands back on the item page; `onAuthenticated`
//    is called after a successful RAWG login (which sets the session in-place, no
//    navigation) so the caller can resume the stashed intent without a round-trip.

export default function AuthOptions({
  returnTo,
  onAuthenticated,
}: {
  returnTo?: string;
  onAuthenticated?: () => void;
}) {
  const router = useRouter();
  const [showRawg, setShowRawg] = useState(false);
  const [rawgEmail, setRawgEmail] = useState("");
  const [rawgPassword, setRawgPassword] = useState("");
  const [rawgLoading, setRawgLoading] = useState(false);
  const [rawgError, setRawgError] = useState("");

  // Same-origin path → a `?returnTo=` query the OAuth start route stashes for the
  // callback. Encoded so slashes in the item path survive.
  const q = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : "";

  async function handleRawgLogin(e: React.FormEvent) {
    e.preventDefault();
    setRawgLoading(true);
    setRawgError("");
    const res = await fetch("/api/auth/rawg", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: rawgEmail, password: rawgPassword }),
    });
    const data = await res.json().catch(() => ({}));
    setRawgLoading(false);
    if (!res.ok) {
      setRawgError(data.error || "Login failed");
      return;
    }
    // RAWG login is a same-page POST that already set the session cookie. Drop
    // the cached anon probe FIRST so callers' reloads see the session (SM6). In
    // the dialog we resume the pending intent in-place; on the login page we
    // navigate.
    resetSessionProbe();
    if (onAuthenticated) onAuthenticated();
    else router.push(data.redirect ?? "/dashboard");
  }

  return (
    <div className="space-y-3">
      {/*
        These MUST stay <a>, not <Link>: they hand the browser off to an OAuth
        endpoint, and Link would client-side navigate and break the redirect.
        The rule only fires because P13's `/[type]/[id]/[slug]` route makes any
        3-segment path (here /api/auth/trakt) look like a page to the linter —
        at runtime the static /api route still wins. False positive.
      */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href={`/api/auth/trakt${q}`}
        className="flex items-center justify-center gap-3 w-full py-3 rounded-xl font-medium transition-all hover:opacity-90"
        style={{ background: "#ed1c2420", border: "1px solid #ed1c2444", color: "#ed1c24" }}>
        <span className="text-lg font-bold">T</span>
        Continue with Trakt.tv
      </a>

      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href={`/api/auth/steam${q}`}
        className="flex items-center justify-center gap-3 w-full py-3 rounded-xl font-medium transition-all hover:opacity-90"
        style={{ background: "#1b9af720", border: "1px solid #1b9af744", color: "#1b9af7" }}>
        <span className="text-lg font-bold">S</span>
        Continue with Steam
      </a>

      {/* Q6: TMDB was connect-only although its callback fully supports fresh
          login (creates the user + session, honors the H2c return cookie). */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href={`/api/auth/tmdb${q}`}
        className="flex items-center justify-center gap-3 w-full py-3 rounded-xl font-medium transition-all hover:opacity-90"
        style={{ background: "#01b4e420", border: "1px solid #01b4e444", color: "#01b4e4" }}>
        <span className="text-lg font-bold">T</span>
        Continue with TMDB
      </a>

      {!showRawg ? (
        <button onClick={() => setShowRawg(true)}
          className="flex items-center justify-center gap-3 w-full py-3 rounded-xl font-medium transition-all hover:opacity-90"
          style={{ background: "#4ade8020", border: "1px solid #4ade8044", color: "#4ade80" }}>
          <span className="text-lg font-bold">R</span>
          Continue with RAWG
        </button>
      ) : (
        <div className="rounded-xl p-4 space-y-3 text-left"
          style={{ background: "#4ade8010", border: "1px solid #4ade8030" }}>
          <p className="text-sm font-medium" style={{ color: "#4ade80" }}>Sign in with RAWG</p>
          <form onSubmit={handleRawgLogin} className="space-y-2">
            <input type="email" placeholder="RAWG email" required
              className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-neutral-500"
              value={rawgEmail} onChange={(e) => setRawgEmail(e.target.value)} />
            <input type="password" placeholder="RAWG password" required
              className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-neutral-500"
              value={rawgPassword} onChange={(e) => setRawgPassword(e.target.value)} />
            {rawgError && <p className="text-red-400 text-xs">{rawgError}</p>}
            <div className="flex gap-2">
              <button type="submit" disabled={rawgLoading}
                className="flex-1 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
                style={{ background: "#4ade80", color: "#000" }}>
                {rawgLoading ? "Signing in..." : "Sign in"}
              </button>
              <button type="button" onClick={() => setShowRawg(false)}
                className="px-3 py-2 rounded-lg text-sm text-neutral-500 hover:text-white transition-colors">
                Cancel
              </button>
            </div>
          </form>
          <p className="text-xs text-neutral-600">
            Your password is used only to sign in to RAWG and is never stored — only the resulting session token is kept.
          </p>
        </div>
      )}
    </div>
  );
}
