"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { resetSessionProbe } from "@/lib/sessionProbe";
import BrandGlyph from "@/components/BrandGlyph";

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

// ── 2026-08-18: brand MARKS, not brand COLOURS ──────────────────────────────
// Nils: "the login modal should drop the color coding of the platforms and
// instead use the platforms logos (the color coding can be removed everywhere on
// fandex)".
//
// Every option used to be a tinted slab — its own hex at 20% fill, 44% border
// and 100% text, with a bare capital letter standing in for a logo. That made
// four saturated blocks in one 320px dialog, gave two different providers the
// same glyph ("T" for both Trakt and TMDB), and was the same fruit-salad problem
// StoreLink already solved on the item page.
//
// So this reuses StoreLink's answer: the real mark from lib/brandMarks
// (simple-icons, inlined — the CSP blocks remote favicons), rendered in the UI's
// own text colour. 2026-08-18: the mark took the BRAND's colour on hover at
// first; Nils — "the hover on the logos ... should be the normal hover highlight
// behavior from other buttons" — so the hover is now the house one and no brand
// hue appears in any state. The logo carries the identity; nothing else has to.
//
// RAWG has no simple-icons entry (see gen-brand-marks.mjs) and falls back to
// <BrandGlyph>'s generic globe — it is the only option here whose word-mark does
// the identifying, which is fine, because every option is labelled in text.
const OPTION_CLASS =
  "group flex items-center justify-center gap-3 w-full py-3 rounded-xl font-medium border border-border " +
  "bg-surface-elevated text-text-primary transition-colors hover:border-border-strong hover:bg-surface-overlay";

// Follows the button's own label colour, so the whole option lights together.
const GLYPH_CLASS = "text-text-secondary transition-colors duration-fast group-hover:text-text-primary";

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
    else router.push(data.redirect ?? "/wishlist");
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
      <a href={`/api/auth/trakt${q}`} className={OPTION_CLASS}>
        <BrandGlyph source="Trakt" size={18} className={GLYPH_CLASS} />
        Continue with Trakt.tv
      </a>

      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href={`/api/auth/steam${q}`} className={OPTION_CLASS}>
        <BrandGlyph source="Steam" size={18} className={GLYPH_CLASS} />
        Continue with Steam
      </a>

      {/* Q6: TMDB was connect-only although its callback fully supports fresh
          login (creates the user + session, honors the H2c return cookie). */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href={`/api/auth/tmdb${q}`} className={OPTION_CLASS}>
        <BrandGlyph source="TMDB" size={18} className={GLYPH_CLASS} />
        Continue with TMDB
      </a>

      {!showRawg ? (
        <button onClick={() => setShowRawg(true)} className={OPTION_CLASS}>
          <BrandGlyph source="RAWG" size={18} className={GLYPH_CLASS} />
          Continue with RAWG
        </button>
      ) : (
        <div className="rounded-xl p-4 space-y-3 text-left bg-surface-elevated border border-border">
          <p className="text-sm font-medium text-text-primary flex items-center gap-2">
            <BrandGlyph source="RAWG" size={18} className={GLYPH_CLASS} />
            Sign in with RAWG
          </p>
          <form onSubmit={handleRawgLogin} className="space-y-2">
            <input type="email" placeholder="RAWG email" required
              className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-strong"
              value={rawgEmail} onChange={(e) => setRawgEmail(e.target.value)} />
            <input type="password" placeholder="RAWG password" required
              className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-strong"
              value={rawgPassword} onChange={(e) => setRawgPassword(e.target.value)} />
            {rawgError && <p className="text-danger text-xs">{rawgError}</p>}
            <div className="flex gap-2">
              {/* The submit is the dialog's one PRIMARY action, so it takes the
                  accent — it used to be `--color-success`, a green that read as
                  a status, not a button, and was part of the same colour
                  scatter this pass removed. */}
              <button type="submit" disabled={rawgLoading}
                className="flex-1 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
                style={{ background: "var(--color-accent)", color: "var(--color-text-on-accent)" }}>
                {rawgLoading ? "Signing in..." : "Sign in"}
              </button>
              <button type="button" onClick={() => setShowRawg(false)}
                className="px-3 py-2 rounded-lg text-sm text-text-secondary hover:text-text-primary transition-colors">
                Cancel
              </button>
            </div>
          </form>
          <p className="text-xs text-text-secondary">
            Your password is used only to sign in to RAWG and is never stored — only the resulting session token is kept.
          </p>
        </div>
      )}
    </div>
  );
}
