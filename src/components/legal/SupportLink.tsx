import { Heart } from "lucide-react";
import type { LegalLocale } from "@/lib/legal/types";

// H3.3 — the donations link, as one component so the footer, the sign-in dialog
// and the profile entry list can't drift apart on url, label or wording.
//
// `NEXT_PUBLIC_*` is inlined at BUILD time, so this is a literal after
// compilation, not a runtime lookup: setting the var later needs a rebuild (a
// Railway redeploy does one anyway). Unset → every consumer renders nothing,
// which is what kept this dark before the Impressum shipped.
//
// **Deliberately NOT behind `MONETIZATION_ENABLED`.** That switch gates
// affiliate links, which are commercial communications under §5 DDG and carry
// §5a UWG labeling duties. A donation link is neither: no cookie on
// fandex.org, no consent banner, nothing to label. It went live with H4.2's
// Impressum (2026-08-03) and is independent of the affiliate programs.
//
// Plain outbound <a>, never Ko-fi's embeddable widget — that loads third-party
// scripts and cookies, which would break §25 TDDDG's strictly-necessary
// exemption and un-park H4.4's consent-banner build. The CSP (`script-src
// 'self'`, `frame-src` YouTube only) would block it anyway.
export const SUPPORT_URL = process.env.NEXT_PUBLIC_SUPPORT_URL?.trim();

const DEFAULT_LABEL: Record<LegalLocale, string> = {
  en: "Support Fandex",
  de: "Fandex unterstützen",
};

/** Whether a donations link is configured at all. */
export function hasSupportLink(): boolean {
  return !!SUPPORT_URL;
}

export function supportLabel(locale: LegalLocale = "en"): string {
  return process.env.NEXT_PUBLIC_SUPPORT_LABEL?.trim() || DEFAULT_LABEL[locale];
}

/**
 * The footer/dialog presentation: a bordered pill with a heart, sitting ABOVE
 * the legal row rather than inside it.
 *
 * It used to be a fifth entry in that row, styled identically to Privacy /
 * Terms / Imprint — which made a voluntary ask look like another legal
 * obligation, and buried it. Pulling it out is also what let the label go back
 * to "Support Fandex": inline, it sat directly beside the "Support" legal link
 * and the two read as duplicates, which is why it was temporarily "Donate".
 */
export default function SupportLink({
  locale = "en",
  onNavigate,
  className = "",
}: {
  locale?: LegalLocale;
  onNavigate?: () => void;
  className?: string;
}) {
  if (!SUPPORT_URL) return null;

  return (
    <div className={`flex justify-center ${className}`}>
      <a
        href={SUPPORT_URL}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onNavigate}
        className="tap-44 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-surface-elevated border border-border text-label text-text-primary hover:border-border-strong hover:text-text-primary transition-colors"
      >
        <Heart className="w-4 h-4 text-accent" aria-hidden />
        {supportLabel(locale)}
      </a>
    </div>
  );
}
