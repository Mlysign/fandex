"use client";
import { useEffect } from "react";
import type { MediaType } from "@/types";
import AuthOptions from "./AuthOptions";
import LegalLinks from "@/components/legal/LegalLinks";

// H2c — the in-page sign-in dialog. An anonymous viewer interacting with the real
// rating / wishlist controls on an item page opens this instead of being bounced
// to the login page. It carries `returnTo` (the item path) into the OAuth flow so
// the callback lands back here, and `onAuthenticated` fires for the no-redirect
// RAWG path so the caller can resume the stashed intent in-place.
//
// Deliberately NOT a popup: OAuth providers are full-page redirects (Trakt
// round-trips through trakt.tv), popup OAuth is blocker-fragile, and it behaves
// badly inside the planned Android TWA. Same UX, one full-page round-trip.
//
// Overlay/close behaviour mirrors ConfirmDialog (backdrop click + Esc).
export default function SignInDialog({
  type,
  returnTo,
  onClose,
  onAuthenticated,
}: {
  /** Item context for the copy; omitted = generic sign-in (e.g. the nav's "Log in"). */
  type?: MediaType;
  returnTo: string;
  onClose: () => void;
  onAuthenticated: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const verb = type === "game" ? "played" : "watched";

  return (
    <div
      className="fixed inset-0 bg-black/60 z-[110] flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Sign in"
    >
      {/* 2026-08-18: the raw neutral-900/700/100/400 literals became the surface
          tokens, alongside the brand-colour removal in AuthOptions — this dialog
          was the last place in the auth flow still hard-coding the dark theme's
          palette instead of reading it. */}
      <div
        className="bg-surface-overlay border border-border-strong rounded-2xl p-6 w-full max-w-sm space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h3 className="font-semibold text-base text-text-primary">
            {type ? "Rate it, track it, don’t lose it" : "Sign in to Fandex"}
          </h3>
          <p className="text-sm text-text-secondary mt-1">
            {type
              ? `Sign in to rate this, mark it ${verb}, and sync your wishlist across Trakt, Steam & more. We’ll bring you right back.`
              : "Track your wishlists, ratings and releases across Trakt, Steam & more. We’ll bring you right back."}
          </p>
        </div>
        <AuthOptions returnTo={returnTo} onAuthenticated={onAuthenticated} />
        {/* H4.10 (2026-08-02) — the anonymous route to `/legal/*`. `AppNav`'s
            "You" slot opens THIS dialog for a logged-out visitor rather than
            linking to /profile, and /profile bounces anon to / before its footer
            renders, so before this the legal pages were unreachable from the UI
            for anyone not signed in. Putting them here makes the chain
            nav → "You" → dialog → link a real two clicks. It also sits where a
            reader most wants them: directly under the buttons that connect an
            account. See LegalLinks for the full writeup. */}
        <div className="pt-4 border-t border-border">
          {/* onClose: AppNav owns this dialog and never unmounts, so without it
              the dialog stays open on top of the page you just navigated to. */}
          <LegalLinks onNavigate={onClose} />
        </div>
      </div>
    </div>
  );
}
