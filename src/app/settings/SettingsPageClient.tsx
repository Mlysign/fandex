"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import BrandGlyph from "@/components/BrandGlyph";
import Button, { buttonClasses } from "@/components/ui/Button";
import Sheet from "@/components/ui/Sheet";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { COUNTRIES } from "@/lib/countries";
import { detectCountry } from "@/lib/detectCountry";
import { syncToCompletion } from "@/lib/syncClient";
import PanelHeader from "@/components/insights/PanelHeader";
import SignInGate from "@/components/auth/SignInGate";
import GoogleMark from "@/components/auth/GoogleMark";
import PlatformPicker from "@/components/settings/PlatformPicker";
import MediaTypePicker from "@/components/settings/MediaTypePicker";
import type { PlatformOption } from "@/lib/platformKeys";
import { resetKnownPlatforms } from "@/lib/useKnownPlatforms";
import { resetSessionProbe } from "@/lib/sessionProbe";
import { Settings as SettingsIcon } from "lucide-react";

// Same gate as components/auth/AuthOptions.tsx: hide Google everywhere until the
// deploy actually has the credential, so a half-configured environment shows the
// old four options rather than a control that errors. Module scope because Next
// inlines a NEXT_PUBLIC_ var into the client bundle at build time.
// ⚠️ Needs the matching Dockerfile ARG, or this reads undefined in prod while
// the server route works. → memory: next-public-env-needs-dockerfile-arg
const googleEnabled = !!process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

// Table → plain-language label for the delete dialog's counts. Tables not listed
// here (anything a future migration adds) are still deleted — they just don't
// get a line in the dialog, which is the safe direction for an unknown name.
const DELETE_LABELS: Array<[string, string]> = [
  ["user_library", "Library entries (with your ratings and reviews)"],
  ["user_watchlist", "Wishlist entries"],
  ["user_item_state", "Per-provider ratings and status"],
  ["user_identities", "Connected accounts"],
  ["sync_log", "Sync history"],
];

function SettingsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const confirm = useConfirm();
  const [user, setUser] = useState<any>(null);
  /** SM52: signed out, render the ask. `user` alone can't carry it (it starts null). */
  const [anon, setAnon] = useState(false);
  const [identities, setIdentities] = useState<any[]>([]);
  const [syncLogs, setSyncLogs] = useState<any[]>([]);
  const [itemCount, setItemCount] = useState(0);
  // The connect/error notice comes from the OAuth redirect's query params — derive
  // it once at init rather than setting state in an effect (react-hooks/set-state-in-effect).
  const [notice, setNotice] = useState<{ msg: string; ok: boolean } | null>(() => {
    const connected = searchParams.get("connected");
    const error = searchParams.get("error");
    if (connected) return { msg: `${connected} connected successfully.`, ok: true };
    if (error) return { msg: `Connection failed: ${error}`, ok: false };
    return null;
  });
  const [syncing, setSyncing] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  // T22 — region that drives release dates + streaming availability.
  const [country, setCountry] = useState<string>("");
  const [savingCountry, setSavingCountry] = useState(false);
  // Your platforms. The option list is surveyed from the user's own catalog by
  // /api/settings/platforms, so it includes the regional services a curated
  // global list would miss (this account carries MagentaTV, WOW, Videoload).
  const [platformOptions, setPlatformOptions] = useState<PlatformOption[]>([]);
  const [ownedPlatforms, setOwnedPlatforms] = useState<string[]>([]);
  const [platformsLoading, setPlatformsLoading] = useState(true);
  // What you track. [] = not configured, i.e. every type is on.
  const [mediaTypes, setMediaTypes] = useState<string[]>([]);
  const [showRawgForm, setShowRawgForm] = useState(false);
  const [rawgEmail, setRawgEmail] = useState("");
  const [rawgPassword, setRawgPassword] = useState("");
  const [rawgLoading, setRawgLoading] = useState(false);
  // H4.6/H4.7 — account deletion (GDPR Art. 17) + export (Art. 20).
  const [showDelete, setShowDelete] = useState(false);
  const [deleteFootprint, setDeleteFootprint] = useState<Record<string, number> | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    fetchMe(true);
    void loadPlatforms();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchMe(initial = false) {
    const res = await fetch("/api/auth/me");
    const data = await res.json();
    // SM52 — this used to router.replace("/"). Settings is entirely the
    // visitor's own account (connections, region, export, deletion), so the
    // page becomes the ask rather than vanishing. A bounce here is worse than
    // most: somebody arriving to DISCONNECT an account or delete their data is
    // exactly the person who must not be told "nothing to see".
    if (!data.user) { setAnon(true); return; }
    setAnon(false);
    setUser(data.user);
    setIdentities(data.identities ?? []);
    setSyncLogs(data.syncLogs ?? []);
    setItemCount(data.itemCount ?? 0);
    // Country: use the stored value; on first visit (none stored) auto-detect
    // from the browser and persist it once so region-aware data is correct.
    setMediaTypes(data.user.mediaTypes ?? []);
    const stored = data.user.country as string | null;
    if (stored) setCountry(stored);
    else if (initial) { const d = detectCountry(); setCountry(d); saveCountry(d); }
  }

  async function saveCountry(code: string) {
    setSavingCountry(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ country: code }),
      });
      if (res.ok) {
        setCountry(code);
        setNotice({ msg: "Region updated.", ok: true });
      }
    } finally {
      setSavingCountry(false);
    }
  }

  async function loadPlatforms() {
    try {
      const res = await fetch("/api/settings/platforms");
      if (!res.ok) return;
      const d = await res.json();
      setPlatformOptions(d.options ?? []);
      setOwnedPlatforms(d.selected ?? []);
    } finally {
      setPlatformsLoading(false);
    }
  }

  async function saveMediaTypes(types: string[]): Promise<string[] | void> {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mediaTypes: types }),
    });
    if (!res.ok) {
      setNotice({ msg: "Could not save what you track. Please try again.", ok: false });
      return;
    }
    const d = await res.json();
    const stored: string[] = d.mediaTypes ?? [];
    setMediaTypes(stored);
    // The session probe's module-level cache holds the OLD mediaTypes, and every
    // list surface reads the default through it. Without this, saving here did
    // NOTHING to Home / Discover / Calendar / My Stuff until a full reload —
    // which reads as the setting being broken (Nils hit exactly that,
    // 2026-09-02). `savePlatforms` below has always done this; this function was
    // written alongside it and never got the same line.
    resetSessionProbe();
    setNotice({ msg: "Default types updated.", ok: true });
    return stored;
  }

  async function savePlatforms(keys: string[]): Promise<string[] | void> {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platforms: keys }),
    });
    if (!res.ok) {
      setNotice({ msg: "Could not save your platforms. Please try again.", ok: false });
      return;
    }
    const d = await res.json();
    const stored: string[] = d.platforms ?? keys;
    setOwnedPlatforms(stored);
    // Both client caches hold the OLD list, and the Filters sheet reads them
    // both. Without this, changing your platforms here does nothing to the
    // filter until a full reload — which reads as the setting not working.
    resetKnownPlatforms();
    resetSessionProbe();
    setNotice({ msg: stored.length ? "Platforms updated." : "Platform filter reset to show everything.", ok: true });
    return stored;
  }

  function getIdentity(provider: string) {
    return identities.find((i) => i.provider === provider);
  }

  function getSyncLog(provider: string) {
    return syncLogs.find((l) => l.provider === provider);
  }

  async function syncProvider(provider: string) {
    setSyncing(provider);
    await syncToCompletion(provider);
    await fetchMe();
    setSyncing(null);
    setNotice({ msg: `${provider} synced.`, ok: true });
  }

  async function disconnect(provider: string) {
    const ok = await confirm({
      title: `Disconnect ${provider}?`,
      message: "Items from this source will be removed from your watchlist.",
      confirmLabel: "Disconnect",
      danger: true,
    });
    if (!ok) return;
    setDisconnecting(provider);
    const res = await fetch("/api/auth/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider }),
    });
    const data = await res.json();
    setDisconnecting(null);
    if (!res.ok) {
      setNotice({ msg: data.error || `Failed to disconnect ${provider}`, ok: false });
    } else {
      setNotice({ msg: `${provider} disconnected.`, ok: true });
      fetchMe();
    }
  }

  async function connectRawg(e: React.FormEvent) {
    e.preventDefault();
    setRawgLoading(true);
    const res = await fetch("/api/auth/rawg", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: rawgEmail, password: rawgPassword }),
    });
    const data = await res.json();
    setRawgLoading(false);
    if (!res.ok) {
      setNotice({ msg: data.error || "RAWG login failed", ok: false });
    } else {
      setNotice({ msg: "RAWG connected successfully.", ok: true });
      setShowRawgForm(false);
      setRawgEmail(""); setRawgPassword("");
      fetchMe();
    }
  }

  // Fetched via JS rather than a plain <a download>: the route is cookie-authed
  // and returns JSON either way, so a failed download would otherwise navigate
  // the user to a raw error body instead of showing a notice.
  async function exportData() {
    setExporting(true);
    try {
      const res = await fetch("/api/account/export");
      if (!res.ok) {
        setNotice({ msg: "Could not prepare your export. Please try again.", ok: false });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `fandex-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setNotice({ msg: "Your data export has been downloaded.", ok: true });
    } finally {
      setExporting(false);
    }
  }

  async function openDeleteDialog() {
    setDeleteConfirm("");
    setShowDelete(true);
    // Show real counts in the dialog — "this deletes 1,900 library entries" is a
    // far better last chance to back out than a generic warning.
    const res = await fetch("/api/account");
    if (res.ok) {
      const data = await res.json();
      setDeleteFootprint(data.perTable ?? null);
    }
  }

  async function deleteAccount() {
    setDeleting(true);
    try {
      const res = await fetch("/api/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "DELETE" }),
      });
      if (!res.ok) {
        setShowDelete(false);
        setNotice({ msg: "Could not delete your account. Nothing was changed.", ok: false });
        return;
      }
      // The session cookie is cleared server-side; a full reload (not a client
      // navigation) makes sure no cached authed state survives on this device.
      window.location.href = "/";
    } finally {
      setDeleting(false);
    }
  }

  // `identityOnly` marks a provider that signs you in and holds no library.
  // It suppresses the Sync button, because there is nothing on the other end to
  // sync and a control that does nothing is indistinguishable from a broken one.
  // It is NOT the same as `canWrite: false`, which means "has a library we can
  // read but not write to" and prints a note saying exactly that.
  const providers = [
    ...(googleEnabled
      ? [{ key: "google", label: "Google", description: "Signs you in. No library to import.", connectUrl: "/api/auth/google", canWrite: false, identityOnly: true }]
      : []),
    { key: "trakt",      label: "Trakt.tv",    description: "Movies & TV shows watchlist",      connectUrl: "/api/auth/trakt",       canWrite: true,  identityOnly: false },
    { key: "tmdb",       label: "TMDB",         description: "Movie & TV watchlist and ratings", connectUrl: "/api/auth/tmdb",        canWrite: true,  identityOnly: false },
    // Letterboxd hidden until an API key is available — re-add when ready.
    { key: "steam",      label: "Steam",        description: "Games from your wishlist",         connectUrl: "/api/auth/steam",       canWrite: false, identityOnly: false },
    { key: "rawg",       label: "RAWG",         description: "Games from your Want to Play list", connectUrl: "rawg-form",           canWrite: true,  identityOnly: false },
  ];

  // Q5's "everything is connected" check. Was three inlined getIdentity() calls
  // repeated in three places, which is how Google would have been added to two
  // of them and missed in the third.
  const loginMethods = ["trakt", "steam", "rawg", ...(googleEnabled ? ["google"] : [])];
  const allLoginMethodsConnected = loginMethods.every((k) => getIdentity(k));

  if (anon) {
    return (
      <div className="min-h-screen">
        <main className="max-w-2xl mx-auto px-6 py-10">
          <SignInGate
            icon={<SettingsIcon className="w-5 h-5" aria-hidden />}
            title="Sign in to open your settings"
            hint="Connections, region, your data export and account deletion all belong to an account. There is nothing here to change without one."
            returnTo="/settings"
            onAuthenticated={() => fetchMe(true)}
          />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* RAWG connect modal — S5 (2026-07-27): migrated onto the shared Sheet
          primitive (focus trap + Escape + return-focus now come from there,
          same as ConfirmDialog since H1.6b) instead of a bespoke fixed-inset
          overlay. */}
      <Sheet open={showRawgForm} onClose={() => setShowRawgForm(false)} title="Connect RAWG" className="p-6">
        <div className="space-y-4 text-text-primary">
          <h3 className="font-serif text-serif-md text-text-primary">Connect RAWG</h3>
          <form onSubmit={connectRawg} className="space-y-3">
            <div>
              <label className="text-xs text-text-secondary block mb-1">RAWG email</label>
              <input type="email" required
                className="w-full bg-surface-inset border border-border-strong rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-secondary focus:outline-none focus:border-accent"
                value={rawgEmail} onChange={(e) => setRawgEmail(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-text-secondary block mb-1">RAWG password</label>
              <input type="password" required
                className="w-full bg-surface-inset border border-border-strong rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-secondary focus:outline-none focus:border-accent"
                value={rawgPassword} onChange={(e) => setRawgPassword(e.target.value)} />
            </div>
            <p className="text-xs text-text-secondary">Your password is used only to sign in to RAWG and is never stored. Only the resulting session token is kept.</p>
            <div className="flex gap-2 pt-1">
              <button type="submit" disabled={rawgLoading}
                className="flex-1 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
                style={{ background: "var(--color-success)", color: "var(--color-neutral-950)" }}>
                {rawgLoading ? "Connecting..." : "Connect"}
              </button>
              <button type="button" onClick={() => setShowRawgForm(false)}
                className="px-4 py-2 rounded-lg text-sm text-text-secondary hover:text-text-primary border border-border-strong transition-colors">
                Cancel
              </button>
            </div>
          </form>
        </div>
      </Sheet>

      {/* Delete-account confirmation (H4.6). Type-to-confirm rather than a plain
          "are you sure": this is the one irreversible action in the app, and the
          same word is required by the API so a stray click can't get there.
          S5 (2026-07-27): migrated onto Sheet — onClose is a no-op while
          `deleting` is in flight, matching the original's guard against
          dismissing mid-delete. */}
      <Sheet
        open={showDelete}
        onClose={() => { if (!deleting) setShowDelete(false); }}
        title="Delete your account?"
        className="p-6"
      >
        <div className="space-y-4">
          <h3 className="font-serif text-serif-md text-danger">Delete your account?</h3>
          <p className="text-sm text-text-secondary">
            This permanently deletes your Fandex account and everything attached to it. It cannot be undone.
          </p>

          {deleteFootprint && (
            <ul className="text-sm text-text-secondary bg-surface-inset border border-border rounded-lg px-4 py-3 space-y-1">
              {DELETE_LABELS.filter(([table]) => (deleteFootprint[table] ?? 0) > 0).map(([table, label]) => (
                <li key={table} className="flex justify-between gap-4">
                  <span>{label}</span>
                  <span className="text-text-primary">{deleteFootprint[table]}</span>
                </li>
              ))}
            </ul>
          )}

          {/* Deliberately no retention NUMBER here: litestream.yml sets no
              `retention`, so the effective window is Litestream's default and
              nobody has confirmed it. H4.3's privacy policy has to state the
              real figure — this text must not invent one first. */}
          <p className="text-xs text-text-secondary">
            Your ratings and lists on Trakt, TMDB, Steam and RAWG are not affected. This clears only what Fandex stores.
            Your data is removed immediately; copies in the backups age out with the backup retention window.
          </p>

          <div>
            <label className="text-xs text-text-secondary block mb-1">
              Type <span className="font-mono text-text-primary">DELETE</span> to confirm
            </label>
            <input
              aria-label="Type DELETE to confirm"
              autoFocus
              className="w-full bg-surface-inset border border-border-strong rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-secondary focus:outline-none focus:border-danger"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
            />
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={deleteAccount}
              disabled={deleteConfirm !== "DELETE" || deleting}
              className="flex-1 py-2 rounded-lg text-sm font-medium bg-danger text-neutral-950 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {deleting ? "Deleting..." : "Delete my account"}
            </button>
            <button type="button" onClick={() => setShowDelete(false)} disabled={deleting}
              className="px-4 py-2 rounded-lg text-sm text-text-secondary hover:text-text-primary border border-border-strong transition-colors">
              Cancel
            </button>
          </div>
        </div>
      </Sheet>

      <main className="max-w-2xl mx-auto px-6 py-10 space-y-8">
        <div className="flex items-center justify-between">
          <h1 className="font-serif text-serif-xl text-text-primary">Settings</h1>
        </div>

        {notice && (
          <div className={`border rounded-lg px-4 py-3 text-sm ${notice.ok ? "bg-success-subtle border-success/40 text-success" : "bg-danger-subtle border-danger/40 text-danger"}`}>
            {notice.msg}
          </div>
        )}

        {/* Connected accounts */}
        <section className="space-y-3">
          <PanelHeader eyebrow="Connected accounts" hint="Any connected account can be used to log in." />

          {providers.map((p) => {
            const identity = getIdentity(p.key);
            const log = getSyncLog(p.key);

            return (
              <div key={p.key} className="bg-surface-elevated border border-border rounded-xl p-5">
                {/* 2026-08-14 (Nils, mobile testing): this was one
                    `justify-between` row with a non-wrapping action group, so
                    at 375px the Connected pill + Sync + Disconnect ran past the
                    panel's right edge and Disconnect was half off-screen. The
                    row now stacks below sm and the action group wraps, so no
                    control can leave the card at any width. */}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-3">
                  <div className="flex items-center gap-3 min-w-0">
                    {/* 2026-08-18: was the provider's first LETTER in a tile
                        tinted with its brand hex — so Trakt and TMDB both showed
                        a "T", and the eight cards were eight different colours.
                        The real mark identifies it and the label is right
                        beside it. See components/BrandGlyph.tsx. */}
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-surface border border-border">
                      {/* Google is the one provider that must keep its own
                          colours. BrandGlyph renders in the UI's text colour,
                          which their branding guidelines forbid for the G.
                          → components/auth/GoogleMark.tsx */}
                      {p.key === "google" ? <GoogleMark size={18} /> : <BrandGlyph source={p.key} size={18} />}
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-text-primary truncate">{p.label}</p>
                      <p className="text-sm text-text-secondary truncate">
                        {identity ? `@${identity.display_name ?? identity.provider_user_id}` : p.description}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {identity ? (
                      <>
                        <span className="text-xs bg-success-subtle text-success px-2.5 py-1 rounded-full border border-success/40">
                          Connected
                        </span>
                        {!p.identityOnly && (
                          <Button onClick={() => syncProvider(p.key)} disabled={syncing === p.key}>
                            {syncing === p.key ? "Syncing..." : "Sync"}
                          </Button>
                        )}
                        <Button variant="danger" onClick={() => disconnect(p.key)} disabled={disconnecting === p.key}>
                          {disconnecting === p.key ? "..." : "Disconnect"}
                        </Button>
                      </>
                    ) : (
                      p.connectUrl === "rawg-form" ? (
                        <button onClick={() => setShowRawgForm(true)}
                          className="text-xs px-4 py-2 rounded-lg font-medium border border-border-strong bg-surface text-text-secondary hover:text-text-primary hover:border-neutral-400 transition-colors">
                          Connect
                        </button>
                      ) : p.connectUrl ? (
                        <a href={p.connectUrl}
                          className="text-xs px-4 py-2 rounded-lg font-medium border border-border-strong bg-surface text-text-secondary hover:text-text-primary hover:border-neutral-400 transition-colors">
                          Connect
                        </a>
                      ) : null
                    )}
                  </div>
                </div>

                {log && (
                  <p className="text-xs text-text-secondary">
                    Last synced {new Date(log.last_sync * 1000).toLocaleString()} · {log.item_count} items · {log.status}
                  </p>
                )}
                {!p.canWrite && !p.identityOnly && identity && (
                  <p className="text-xs text-text-secondary mt-1">
                    {/* Template string, not JSX text: the space after {p.label} gets
                        swallowed in the compiled output (SM5). */}
                    {`Read-only. ${p.label} doesn’t support adding to a wishlist via its API.`}
                  </p>
                )}
                {p.identityOnly && identity && (
                  <p className="text-xs text-text-secondary mt-1">
                    Used to sign you in. Connect a platform below to bring a library across.
                  </p>
                )}
              </div>
            );
          })}
        </section>

        {/* Add login method. Q5: when every connectable provider is already
            linked the buttons all vanish — say so instead of rendering an
            empty section. */}
        <section className="space-y-3">
          <PanelHeader
            eyebrow="Add login method"
            hint={
              allLoginMethodsConnected
                ? "All available login methods are connected. Any of them can sign you in."
                : "Connect another account to log in with it in the future."
            }
          />
          {!allLoginMethodsConnected && (
          /*
            <a>, not <Link>: these hand off to an OAuth endpoint and Link would
            client-side navigate, breaking the redirect. The rule fires only
            because P13's `/[type]/[id]/[slug]` makes 3-segment paths look like
            pages to the linter; the static /api route still wins at runtime.
          */
          <div className="flex gap-3 flex-wrap">
            {googleEnabled && !getIdentity("google") && (
              // eslint-disable-next-line @next/next/no-html-link-for-pages
              <a href="/api/auth/google" className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-lg border border-border-strong bg-surface-elevated text-text-secondary hover:text-text-primary hover:border-neutral-400 transition-colors">
                <GoogleMark size={15} />
                Connect Google
              </a>
            )}
            {!getIdentity("trakt") && (
              // eslint-disable-next-line @next/next/no-html-link-for-pages
              <a href="/api/auth/trakt" className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-lg border border-border-strong bg-surface-elevated text-text-secondary hover:text-text-primary hover:border-neutral-400 transition-colors">
                <BrandGlyph source="trakt" size={15} />
                Connect Trakt
              </a>
            )}
            {/* Letterboxd hidden until an API key is available — re-add when ready. */}
            {!getIdentity("steam") && (
              // eslint-disable-next-line @next/next/no-html-link-for-pages
              <a href="/api/auth/steam" className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-lg border border-border-strong bg-surface-elevated text-text-secondary hover:text-text-primary hover:border-neutral-400 transition-colors">
                <BrandGlyph source="steam" size={15} />
                Connect Steam
              </a>
            )}
            {!getIdentity("rawg") && (
              <button onClick={() => setShowRawgForm(true)} className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-lg border border-border-strong bg-surface-elevated text-text-secondary hover:text-text-primary hover:border-neutral-400 transition-colors">
                <BrandGlyph source="rawg" size={15} />
                Connect RAWG
              </button>
            )}
          </div>
          )}
        </section>

        {/* Import (2026-09-02). `/import` shipped 2026-08-23 with the page, both
            API routes and src/lib/import/ complete — and NOTHING anywhere in the
            app linking to it, so the only way in was typing the URL. Nils: "i
            never tried the letterboxd and backloggd import because i dont know
            how. i would have expected an import button in my user settings."
            ⚠️ Letterboxd and IMDb only. Backloggd has no export: its CSV export
            tool is roadmap item 6 (7K votes, unbuilt, checked 2026-09-02), and
            /settings/import_export/ on their site renders an empty panel. */}
        <section className="space-y-3">
          <PanelHeader
            eyebrow="Import"
            hint="Bring ratings and watchlists across from another tracker."
          />
          <div className="bg-surface-elevated border border-border rounded-xl p-5 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="font-medium text-sm text-text-primary">Import from Letterboxd or IMDb</p>
              <p className="text-xs text-text-secondary">
                Both let you download your own data for free. Drop the file in and Fandex reads
                your ratings and watchlist from it.
              </p>
            </div>
            <Link href="/import" className={buttonClasses()}>Import</Link>
          </div>
        </section>

        {/* Region (T22) */}
        <section className="space-y-3">
          <PanelHeader eyebrow="Region" hint="Controls which release dates and streaming availability you see." />
          <div className="bg-surface-elevated border border-border rounded-xl p-5 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="font-medium text-sm text-text-primary">Country</p>
              <p className="text-xs text-text-secondary">Release dates and &ldquo;where to watch&rdquo; use this region.</p>
            </div>
            <select
              aria-label="Country"
              value={country}
              disabled={savingCountry || !country}
              onChange={(e) => saveCountry(e.target.value)}
              className="flex-shrink-0 bg-surface-inset border border-border-strong rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent disabled:opacity-50"
            >
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>{c.name}</option>
              ))}
            </select>
          </div>
        </section>

        {/* What you track (2026-08-27). Above the platform picker because it is
            the coarser choice: turning Games off makes the games half of that
            list irrelevant. */}
        <MediaTypePicker value={mediaTypes} onSave={saveMediaTypes} />

        {/* Your platforms (2026-08-27) — narrows the "Available on" filter to
            what you actually subscribe to and own. Sits under Region because it
            depends on it: the streaming half of the list is resolved for that
            country. */}
        <PlatformPicker
          options={platformOptions}
          value={ownedPlatforms}
          loading={platformsLoading}
          onSave={savePlatforms}
        />

        {/* Account info */}
        <section className="space-y-3">
          <PanelHeader eyebrow="Account" />
          <div className="bg-surface-elevated border border-border rounded-xl p-5 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-text-secondary">Logged in as</span>
              <span className="text-text-primary">{user?.displayName} via {user?.provider}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-secondary">Watchlist items</span>
              <span className="text-text-primary">{itemCount}</span>
            </div>
          </div>
        </section>

        {/* Your data (H4.6 + H4.7 — GDPR Art. 17 + Art. 20) */}
        <section className="space-y-3">
          <PanelHeader eyebrow="Your data" />

          <div className="bg-surface-elevated border border-border rounded-xl p-5 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="font-medium text-sm text-text-primary">Download your data</p>
              <p className="text-xs text-text-secondary">
                Everything Fandex stores about you, as a JSON file: library, wishlist, ratings and connected accounts.
              </p>
            </div>
            <Button onClick={exportData} disabled={exporting}>
              {exporting ? "Preparing..." : "Download"}
            </Button>
          </div>

          <div className="bg-surface-elevated border border-danger/40 rounded-xl p-5 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="font-medium text-sm text-danger">Delete your account</p>
              <p className="text-xs text-text-secondary">
                Permanently removes your account and everything in it. This cannot be undone.
              </p>
            </div>
            <Button variant="danger" onClick={openDeleteDialog}>Delete</Button>
          </div>
        </section>
      </main>
    </div>
  );
}

export default function SettingsPageClient() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <SettingsContent />
    </Suspense>
  );
}
