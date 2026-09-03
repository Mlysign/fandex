"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, ArrowUpRight, Check, AlertTriangle, Loader2, Monitor } from "lucide-react";
import Panel from "@/components/ui/Panel";
import Button from "@/components/ui/Button";
import Eyebrow from "@/components/ui/Eyebrow";
import { useToast } from "@/components/ui/Toast";

// PL4 — the import surface. Design and the reasoning behind each step are in
// docs/letterboxd-import.md.
//
// Two things here are load-bearing rather than decorative:
//
//  1. THE ANDROID WARNING IS NOT BOILERPLATE. Verified on a real Pixel 8: the
//     Letterboxd app declares an intent filter for letterboxd.com with NO path
//     restriction and AutoVerify=true, and it beats Chrome in the resolver, so
//     the link opens their in-app webview where pressing Export Data downloads
//     NOTHING and shows no error. Anyone on Android hits that unless told.
//     iOS is fine: their app file excludes /settings/* and /user/*.
//
//  2. BOTH MOBILE PATHS ARE OFFERED (Nils, 2026-08-23). Plenty of people will
//     happily escape the app; forcing a handoff would be patronising and hiding
//     the problem would be dishonest. So: continue here, or continue on a
//     computer, with the cost of each stated.

const EXPORT_URL = "https://letterboxd.com/settings/data/";

interface Analysis {
  token: string;
  source: string;
  filesRead: string[];
  total: number;
  matched: number;
  /** The catalog's own half of `matched`. Present since 2026-09-03. */
  matchedLocally?: number;
  /** The half resolved at TMDB, created on import. Present since 2026-09-03. */
  matchedAtProvider?: number;
  unmatched: number;
  ratings: number;
  wishlist: number;
  sample: { title: string; year: number | null; rating: number | null }[];
  unmatchedSample: { title: string; year: number | null }[];
  signedIn: boolean;
}

export default function ImportPageClient({ signedIn }: { signedIn: boolean }) {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const router = useRouter();

  // Client-side, because the warning is device-specific and the page is
  // otherwise server-rendered. Not a UA sniff for behaviour, only for a hint.
  //
  // The disable is the repo's usual justified one for reading a browser-only
  // global on mount: `navigator` does not exist during the server render, so
  // this cannot be an initial-state value. It was missing when PL4 shipped
  // (2026-08-23), which left `npm run lint` at 1 error and CI red, and CI red
  // is what stops a push reaching prod. Added 2026-08-26.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setIsAndroid(/Android/i.test(navigator.userAgent)); }, []);

  async function upload(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      for (const f of list) form.append("file", f);
      const res = await fetch("/api/import/analyze", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "That file could not be read."); return; }
      setAnalysis(data);
    } catch {
      setError("That upload did not complete. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!analysis) return;
    setBusy(true);
    try {
      const res = await fetch("/api/import/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: analysis.token }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "The import could not be applied."); return; }
      toast(`${data.imported} titles added to your library.`, "success");
      router.push("/insights");
    } catch {
      setError("The import could not be applied. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Eyebrow>Import</Eyebrow>
        <h1 className="text-serif-xl font-serif">Bring your films with you</h1>
        <p className="text-body text-text-secondary">
          Letterboxd and IMDb both let you download your own data for free. Fandex reads your
          ratings and your watchlist from it. Nothing else in the file is opened.
        </p>
      </header>

      {!analysis && (
        <>
          <Panel className="p-4 flex flex-col gap-3">
            <h2 className="text-title">Get your export</h2>
            <ol className="flex flex-col gap-2 text-body-sm text-text-secondary list-decimal pl-4">
              <li>Open your Letterboxd data settings and press <strong className="text-text-primary">Export Data</strong>.</li>
              <li>A ZIP file downloads.</li>
              <li>Drop it below, exactly as it downloaded.</li>
            </ol>

            <a href={EXPORT_URL} target="_blank" rel="noopener noreferrer" className="self-start">
              <Button variant="secondary" size="md">
                Open Letterboxd export page <ArrowUpRight size={14} className="ml-1" />
              </Button>
            </a>

            {isAndroid && (
              // Verified on a Pixel 8, not a precaution. See the file header.
              <div className="flex gap-2 p-3 rounded-lg bg-surface-inset border border-border">
                <AlertTriangle size={16} className="shrink-0 mt-0.5 text-warning" aria-hidden />
                <div className="flex flex-col gap-2 min-w-0">
                  <p className="text-body-sm text-text-secondary">
                    On Android this link usually opens the Letterboxd app, and the download does
                    not work there. If that happens, tap the three dots and choose
                    {" "}<strong className="text-text-primary">Open in browser</strong>.
                  </p>
                  <p className="text-caption text-text-muted flex items-center gap-1.5">
                    <Monitor size={12} aria-hidden />
                    Or open fandex.org/import on a computer, where this takes about ten seconds.
                  </p>
                </div>
              </div>
            )}
          </Panel>

          <Panel
            className={`p-8 flex flex-col items-center gap-3 text-center border-dashed transition-colors ${
              dragging ? "border-accent bg-surface-inset" : ""
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); void upload(e.dataTransfer.files); }}
          >
            <Upload size={22} className="text-text-muted" aria-hidden />
            <div className="flex flex-col gap-1">
              <p className="text-body">Drop your export here</p>
              <p className="text-caption text-text-muted">
                The ZIP as downloaded, or a ratings.csv / watchlist.csv
              </p>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept=".zip,.csv"
              multiple
              className="sr-only"
              onChange={(e) => e.target.files && void upload(e.target.files)}
            />
            <Button variant="primary" size="md" onClick={() => inputRef.current?.click()} disabled={busy}>
              {busy ? <><Loader2 size={14} className="animate-spin mr-1.5" /> Reading</> : "Choose file"}
            </Button>
          </Panel>
        </>
      )}

      {error && (
        <Panel className="p-4 flex gap-2 border-danger">
          <AlertTriangle size={16} className="shrink-0 mt-0.5 text-danger" aria-hidden />
          <p className="text-body-sm text-text-secondary">{error}</p>
        </Panel>
      )}

      {analysis && (
        <Panel className="p-4 flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-title">
              {analysis.matched.toLocaleString()} of {analysis.total.toLocaleString()} titles matched
            </h2>
            <p className="text-body-sm text-text-secondary">
              {analysis.ratings.toLocaleString()} ratings and {analysis.wishlist.toLocaleString()}{" "}
              watchlist entries, read from {analysis.filesRead.join(" and ")}.
            </p>
            {/* 2026-09-03. The headline number is now the catalog's answer PLUS
                TMDB's, so say which is which. Nils read the old screen as "half
                my export would be lost", and the honest reassurance is not
                softer wording, it is the sentence that says the titles we did
                not already hold are being fetched rather than dropped. */}
            {(analysis.matchedAtProvider ?? 0) > 0 && (
              <p className="text-body-sm text-text-secondary">
                {analysis.matchedLocally?.toLocaleString()} were already in our catalog.
                The other {analysis.matchedAtProvider!.toLocaleString()} were found on TMDB
                and will be added when you import.
              </p>
            )}
          </div>

          {analysis.sample.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {analysis.sample.map((s, i) => (
                <li key={i} className="text-caption px-2 py-1 rounded-sm bg-surface-inset text-text-secondary">
                  {s.title}{s.year ? ` (${s.year})` : ""}{s.rating != null ? ` · ${s.rating}/10` : ""}
                </li>
              ))}
            </ul>
          )}

          {analysis.unmatched > 0 && (
            // Shown BEFORE anything is applied. An import that quietly drops a
            // tail is the failure this feature exists to avoid.
            <details className="text-body-sm">
              {/* "in our catalog" was accurate and misleading at the same time,
                  because the catalog was the only place we looked. These are
                  now the rows neither the catalog nor TMDB could identify. */}
              <summary className="cursor-pointer text-text-secondary">
                {analysis.unmatched.toLocaleString()} could not be identified, here or on TMDB
              </summary>
              <ul className="mt-2 flex flex-col gap-0.5 text-caption text-text-muted">
                {analysis.unmatchedSample.map((u, i) => (
                  <li key={i}>{u.title}{u.year ? ` (${u.year})` : ""}</li>
                ))}
                {analysis.unmatched > analysis.unmatchedSample.length && (
                  <li>and {(analysis.unmatched - analysis.unmatchedSample.length).toLocaleString()} more</li>
                )}
              </ul>
            </details>
          )}

          {signedIn ? (
            <Button variant="primary" size="lg" onClick={apply} disabled={busy}>
              {busy
                ? <><Loader2 size={14} className="animate-spin mr-1.5" /> Importing</>
                : <><Check size={14} className="mr-1.5" /> Import {analysis.matched.toLocaleString()} titles</>}
            </Button>
          ) : (
            // Import-before-signup: they have already seen what they get, which
            // is a far better reason to make an account than a wall is.
            <div className="flex flex-col gap-2">
              <p className="text-body-sm text-text-secondary">
                Create an account to keep these. Your file is held for a day while you do.
              </p>
              <a href={`/login?next=${encodeURIComponent("/import?token=" + analysis.token)}`}>
                <Button variant="primary" size="lg" className="w-full">Create an account and keep these</Button>
              </a>
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
