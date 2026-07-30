"use client";
import { useRouter } from "next/navigation";
import { ArrowLeft, Share2, Check } from "lucide-react";
import { useState } from "react";
import { cdnImageUrl } from "@/lib/imageLoader";
import { TYPE_COLORS } from "@/lib/constants";
import type { MediaType } from "@/types";
import { hasPriorPageView } from "@/lib/navHistory";

// The mockup's item-detail hero (04-pages/item-detail.html, frames 1-3): a
// full-bleed 3:4 poster with a bottom scrim carrying the type eyebrow, the serif
// title and a mono meta line, plus floating circular back/share controls.
//
// MOBILE ONLY (`lg:hidden` at the call site). The mockup has no desktop frame for
// this page, and a full-bleed 3:4 hero on a 1280px viewport would be a
// full-screen poster — so desktop keeps the two-column layout and reuses the same
// TitleBlock content. See ItemView.
//
// SSR-SAFE: nothing here reads a session. The hero deliberately does NOT carry
// the mockup's Save button even though the mockup draws one — ItemView's rule is
// that nothing above <PersonalSection> may depend on the viewer, or the public
// HTML varies per user and the SSR/crawler guarantee breaks. The mockup renders
// Save twice anyway (hero + the Rate/Save pair), so nothing is lost.

export interface HeroMeta {
  type: MediaType;
  title: string;
  /** Pre-formatted parts for the mono line, e.g. ["2026", "2h 08m", "dir. Lena Marsh"]. */
  metaParts: string[];
}

export default function DetailHero({
  image, meta, className = "",
}: {
  image: string | null;
  meta: HeroMeta;
  className?: string;
}) {
  const router = useRouter();
  const [shared, setShared] = useState(false);
  // Same rule BackButton encodes (T14): router.back() is a dead control on a
  // hard-loaded or shared link, and a bare push() would throw away real in-app
  // history (and its scroll restoration). Read during render, not an effect.
  const [canGoBack] = useState(() => hasPriorPageView());

  async function share() {
    const url = window.location.href;
    try {
      // navigator.share is the right affordance on the mobile viewport this hero
      // is for; the clipboard fallback covers desktop dev + unsupported browsers.
      if (navigator.share) await navigator.share({ title: meta.title, url });
      else {
        await navigator.clipboard.writeText(url);
        setShared(true);
        setTimeout(() => setShared(false), 1600);
      }
    } catch { /* user dismissed the share sheet — not an error */ }
  }

  const circle =
    "w-9 h-9 rounded-full flex items-center justify-center text-text-primary " +
    "bg-neutral-950/55 backdrop-blur-sm border border-white/10 transition-colors hover:bg-neutral-950/75";

  return (
    <div className={`relative w-full ${className}`} style={{ aspectRatio: "3 / 4" }}>
      {image ? (
        /* Plain <img>, same reasoning as MediaGallery: a remote poster has no
           known intrinsic size here, and it's routed through cdnImageUrl so a
           full-size RAWG original (up to 3.8 MB — PR10) isn't shipped whole. */
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={cdnImageUrl(image, 1080)} alt={meta.title} className="absolute inset-0 w-full h-full object-cover" />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-b from-neutral-700 to-neutral-900" />
      )}

      {/* Bottom scrim — the mockup's three-stop gradient, so the title stays
          legible over any artwork. */}
      <div
        className="absolute inset-x-0 bottom-0 h-2/3"
        style={{ background: "linear-gradient(to top, rgb(16 14 12 / 0.98) 6%, rgb(16 14 12 / 0.55) 44%, transparent)" }}
      />

      <div className="absolute top-3.5 left-4 right-4 flex items-center justify-between">
        <button
          type="button"
          onClick={() => (canGoBack ? router.back() : router.push("/discover"))}
          aria-label="Back"
          className={`tap-44 ${circle}`}
        >
          <ArrowLeft className="w-5 h-5" aria-hidden />
        </button>
        <button type="button" onClick={share} aria-label="Share this title" className={`tap-44 ${circle}`}>
          {shared ? <Check className="w-4 h-4" aria-hidden /> : <Share2 className="w-4 h-4" aria-hidden />}
        </button>
      </div>

      <div className="absolute inset-x-0 bottom-0 px-5 pb-5">
        <div className="inline-flex items-center gap-1.5 mb-2.5">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: TYPE_COLORS[meta.type] }} />
          <span className="font-mono text-eyebrow uppercase text-text-secondary">{meta.type}</span>
        </div>
        <h1 className="font-serif text-serif-2xl text-text-primary">{meta.title}</h1>
        {meta.metaParts.length > 0 && (
          <p className="font-mono text-meta text-neutral-200 mt-2">{meta.metaParts.join(" · ")}</p>
        )}
      </div>
    </div>
  );
}
