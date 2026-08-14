"use client";
import { useRouter } from "next/navigation";
import { ArrowLeft, Share2, Check } from "lucide-react";
import { useRef, useState } from "react";
import { cdnImageUrl } from "@/lib/imageLoader";
import { TYPE_COLORS } from "@/lib/constants";
import type { MediaType } from "@/types";
import { hasPriorPageView } from "@/lib/navHistory";
import { scrollBehavior } from "@/lib/scrollBehavior";

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
//
// ── 2026-08-14: THE HERO *IS* THE GALLERY ───────────────────────────────────
// Nils: "the details page starts with a poster, then the name, then the image
// gallery. The poster should BE the gallery — let me swipe left/right through
// the images." Mobile used to render the lead image here and the full set again
// in <MediaGallery> further down the page, so the poster was a dead end and the
// gallery was somewhere else entirely. Now this carousel is the only image
// surface on mobile and MediaGallery is desktop-only.
//
// Swiping is a NATIVE scroll-snap container, not a JS drag handler: it gets
// real touch momentum, rubber-banding, trackpad and keyboard scrolling, and
// works with zero JS if hydration is slow. JS only READS the scroll position to
// light the right dot. A hand-rolled pointer-drag would have to reimplement all
// of that and would still feel wrong on a phone.
//
// Every overlay (scrim, title, dots) is pointer-events-none so a swipe that
// starts on the title still reaches the scroller underneath — the title block
// covers the bottom third, which is exactly where a thumb lands. The two
// buttons re-enable pointer events for themselves.

export interface HeroMeta {
  type: MediaType;
  title: string;
  /** Pre-formatted parts for the mono line, e.g. ["2026", "2h 08m", "dir. Lena Marsh"]. */
  metaParts: string[];
}

export default function DetailHero({
  images, meta, className = "",
}: {
  /** Poster first, then gallery art. Empty renders the gradient placeholder. */
  images: string[];
  meta: HeroMeta;
  className?: string;
}) {
  const router = useRouter();
  const [shared, setShared] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  // A slide whose image 404s. Tracked by INDEX rather than filtered out of the
  // array, so the remaining slides keep their positions and the dots don't
  // renumber underneath the reader mid-scroll.
  const [failed, setFailed] = useState<Set<number>>(new Set());
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

  const multi = images.length > 1;

  // Which slide is centred. Rounding the ratio means the dot flips at the
  // halfway point of a drag rather than when the scroll settles, which is what
  // makes the indicator feel attached to the finger.
  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el || el.clientWidth === 0) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    setActive((prev) => (prev === i ? prev : Math.max(0, Math.min(i, images.length - 1))));
  };

  const goTo = (i: number) => {
    const el = scrollerRef.current;
    el?.scrollTo({ left: i * el.clientWidth, behavior: scrollBehavior() });
  };

  return (
    <div className={`relative w-full ${className}`} style={{ aspectRatio: "3 / 4" }}>
      {images.length > 0 ? (
        <div
          ref={scrollerRef}
          onScroll={onScroll}
          className="absolute inset-0 flex overflow-x-auto overflow-y-hidden snap-x snap-mandatory overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          // A carousel is a list of images, so it's a group with a name rather
          // than a bare scrolling div. Each slide names its own position.
          role="group"
          aria-roledescription="carousel"
          aria-label={`${meta.title} — images`}
        >
          {images.map((src, i) => (
            <div
              key={`${src}-${i}`}
              className="relative w-full h-full shrink-0 snap-center snap-always"
              role="group"
              aria-roledescription="slide"
              aria-label={`Image ${i + 1} of ${images.length}`}
            >
              {failed.has(i) ? (
                <div className="absolute inset-0 bg-gradient-to-b from-neutral-700 to-neutral-900" />
              ) : (
                /* Plain <img>, same reasoning as MediaGallery: a remote poster
                   has no known intrinsic size here, and it's routed through
                   cdnImageUrl so a full-size RAWG original (up to 3.8 MB —
                   PR10) isn't shipped whole. Only the first slide is eager;
                   the rest are one swipe away at minimum, and making all of
                   them eager would put every gallery image on the critical
                   path of a page whose LCP *is* slide one. */
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={cdnImageUrl(src, 1080)}
                  alt={i === 0 ? meta.title : ""}
                  loading={i === 0 ? "eager" : "lazy"}
                  className="absolute inset-0 w-full h-full object-cover"
                  onError={() => setFailed((s) => new Set(s).add(i))}
                />
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="absolute inset-0 bg-gradient-to-b from-neutral-700 to-neutral-900" />
      )}

      {/* Bottom scrim — the mockup's three-stop gradient, so the title stays
          legible over any artwork. pointer-events-none: it covers the bottom
          two thirds, which is where a swiping thumb lands. */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3"
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

      <div className="pointer-events-none absolute inset-x-0 bottom-0 px-5 pb-5">
        {multi && (
          // Dots sit ABOVE the title block, not over the artwork: on a 3:4 hero
          // the vertical centre is usually a face. They are real buttons (a
          // pointer/keyboard user has no swipe) and so opt back into pointer
          // events, but the row around them stays transparent to a drag.
          <div className="pointer-events-auto flex items-center gap-1.5 mb-3">
            {images.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => goTo(i)}
                aria-label={`Show image ${i + 1} of ${images.length}`}
                aria-current={i === active ? "true" : undefined}
                className="tap-44-y py-1"
              >
                <span
                  className={`block h-1.5 rounded-full transition-all duration-[var(--duration-fast)] ${
                    i === active ? "w-5 bg-text-primary" : "w-1.5 bg-text-primary/40"
                  }`}
                />
              </button>
            ))}
          </div>
        )}
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
