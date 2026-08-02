import LegalLinks from "./LegalLinks";

// H4.1/H4.5/H4.8/H4.6/H4.7 — the legal footer at the bottom of /profile.
//
// It is no longer the ONLY route to `/legal/*`. H4.1 locked this as
// /profile-only on 2026-07-18, reasoning that the BGH two-click rule only needs
// /profile reachable from everywhere, "which H1's nav already guarantees" —
// H4.10's compliance review (2026-08-02) found that holds for logged-in
// visitors and fails for anonymous ones, so `SignInDialog` now renders the same
// links. The list and its tap-target/wrap handling live in `LegalLinks` so the
// two call sites can't drift apart.
export default function LegalFooter() {
  return (
    <footer className="mt-10 pt-6 border-t border-border">
      <LegalLinks />
    </footer>
  );
}
