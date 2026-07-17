"use client";
import { useEffect } from "react";
import { MediaType } from "@/types";
import AuthOptions from "./AuthOptions";

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
  type: MediaType;
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
      <div
        className="bg-neutral-900 border border-neutral-700 rounded-2xl p-6 w-full max-w-sm space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h3 className="font-semibold text-base text-neutral-100">Rate it, track it, don&apos;t lose it</h3>
          <p className="text-sm text-neutral-400 mt-1">
            Sign in to rate this, mark it {verb}, and sync your wishlist across Trakt, Steam &amp; more. We&apos;ll bring you right back.
          </p>
        </div>
        <AuthOptions returnTo={returnTo} onAuthenticated={onAuthenticated} />
      </div>
    </div>
  );
}
