"use client";
import { useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { Lock } from "lucide-react";
import EmptyState from "@/components/ui/EmptyState";
import Button, { buttonClasses } from "@/components/ui/Button";
import SignInDialog from "@/components/auth/SignInDialog";
import { resetSessionProbe } from "@/lib/sessionProbe";

// SM52 (2026-08-27) — the one shape a signed-out visitor gets on a page that
// needs a session. Extracted from MyStuffView's AN2 block so /insights,
// /profile and /settings stop doing the thing that block exists to replace.
//
// WHY A BOUNCE IS WRONG, and it took two rounds to land. Those three pages
// `router.replace("/")`d an anonymous visitor. AGENTS.md's own invariant says a
// gate must ASK, never disappear: a page that vanishes is indistinguishable
// from a broken link, and the person hitting it is the one least able to work
// out that a sign-in was needed. Nils's words on the first instance: "clicking
// 'wishlist' did redirect to home instead of asking to sign up."
//
// WHAT IT DOES NOT DO. It does not gate a page that has a public half. The
// calendar and the item pages render for everybody and swap only their personal
// controls; reaching for this on one of those would hide real content. Use it
// where the WHOLE page is the user's own data.
export default function SignInGate({
  title,
  hint,
  returnTo,
  icon,
  onAuthenticated,
}: {
  title: string;
  hint: string;
  /** Path the OAuth callback returns to. Include the query the visitor asked for. */
  returnTo: string;
  icon?: ReactNode;
  /** Re-run the page's own init. RAWG signs in with no redirect, so nothing re-mounts on its own. */
  onAuthenticated: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <EmptyState
        className="mt-20"
        icon={icon ?? <Lock className="w-5 h-5" aria-hidden />}
        title={title}
        hint={hint}
        actions={
          <>
            <Button variant="primary" size="md" onClick={() => setOpen(true)}>Sign in</Button>
            <Link href="/discover" className={buttonClasses("outline", "md")}>Browse without an account →</Link>
          </>
        }
      />
      {open && (
        <SignInDialog
          returnTo={returnTo}
          onClose={() => setOpen(false)}
          onAuthenticated={() => { resetSessionProbe(); setOpen(false); onAuthenticated(); }}
        />
      )}
    </>
  );
}
