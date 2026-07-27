"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SOURCE_COLORS } from "@/lib/constants";
import Button from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { COUNTRIES } from "@/lib/countries";
import { detectCountry } from "@/lib/detectCountry";
import { syncToCompletion } from "@/lib/syncClient";
import { usePageTitle } from "@/lib/usePageTitle";

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
  usePageTitle("Profile");
  const router = useRouter();
  const searchParams = useSearchParams();
  const confirm = useConfirm();
  const [user, setUser] = useState<any>(null);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchMe(initial = false) {
    const res = await fetch("/api/auth/me");
    const data = await res.json();
    if (!data.user) { router.replace("/"); return; }
    setUser(data.user);
    setIdentities(data.identities ?? []);
    setSyncLogs(data.syncLogs ?? []);
    setItemCount(data.itemCount ?? 0);
    // Country: use the stored value; on first visit (none stored) auto-detect
    // from the browser and persist it once so region-aware data is correct.
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

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/");
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

  const providers = [
    { key: "trakt",      label: "Trakt.tv",    description: "Movies & TV shows watchlist",      connectUrl: "/api/auth/trakt",       canWrite: true  },
    { key: "tmdb",       label: "TMDB",         description: "Movie & TV watchlist and ratings", connectUrl: "/api/auth/tmdb",        canWrite: true  },
    // Letterboxd hidden until an API key is available — re-add when ready.
    { key: "steam",      label: "Steam",        description: "Games from your wishlist",         connectUrl: "/api/auth/steam",       canWrite: false },
    { key: "rawg",       label: "RAWG",         description: "Games from your Want to Play list", connectUrl: "rawg-form",           canWrite: true  },
  ];

  return (
    <div className="min-h-screen">
      {/* RAWG connect modal */}
      {showRawgForm && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
          onClick={() => setShowRawgForm(false)}>
          <div className="bg-surface-elevated border border-border-strong rounded-2xl p-6 w-full max-w-sm space-y-4 text-text-primary"
            onClick={(e) => e.stopPropagation()}>
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
              <p className="text-xs text-text-secondary">Your password is used only to sign in to RAWG and is never stored — only the resulting session token is kept.</p>
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
        </div>
      )}

      {/* Delete-account confirmation (H4.6). Type-to-confirm rather than a plain
          "are you sure": this is the one irreversible action in the app, and the
          same word is required by the API so a stray click can't get there. */}
      {showDelete && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
          onClick={() => !deleting && setShowDelete(false)}>
          <div className="bg-surface-elevated border border-danger/40 rounded-2xl p-6 w-full max-w-md space-y-4"
            onClick={(e) => e.stopPropagation()}>
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
              Your ratings and lists on Trakt, TMDB, Steam and RAWG are not affected — only what Fandex stores.
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
        </div>
      )}

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
          <h2 className="font-serif text-serif-md text-text-primary">Connected accounts</h2>
          <p className="text-sm text-text-secondary">Any connected account can be used to log in.</p>

          {providers.map((p) => {
            const identity = getIdentity(p.key);
            const log = getSyncLog(p.key);
            const color = SOURCE_COLORS[p.key] ?? "#888";

            return (
              <div key={p.key} className="bg-surface-elevated border border-border rounded-xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold"
                      style={{ background: `${color}20`, color }}>
                      {p.label[0]}
                    </div>
                    <div>
                      <p className="font-medium text-text-primary">{p.label}</p>
                      <p className="text-sm text-text-secondary">
                        {identity ? `@${identity.display_name ?? identity.provider_user_id}` : p.description}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {identity ? (
                      <>
                        <span className="text-xs bg-success-subtle text-success px-2.5 py-1 rounded-full border border-success/40">
                          Connected
                        </span>
                        <Button onClick={() => syncProvider(p.key)} disabled={syncing === p.key}>
                          {syncing === p.key ? "Syncing..." : "Sync"}
                        </Button>
                        <Button variant="danger" onClick={() => disconnect(p.key)} disabled={disconnecting === p.key}>
                          {disconnecting === p.key ? "..." : "Disconnect"}
                        </Button>
                      </>
                    ) : (
                      p.connectUrl === "rawg-form" ? (
                        <button onClick={() => setShowRawgForm(true)}
                          className="text-xs px-4 py-2 rounded-lg font-medium transition-colors"
                          style={{ background: `${color}20`, border: `1px solid ${color}44`, color }}>
                          Connect
                        </button>
                      ) : p.connectUrl ? (
                        <a href={p.connectUrl}
                          className="text-xs px-4 py-2 rounded-lg font-medium transition-colors"
                          style={{ background: `${color}20`, border: `1px solid ${color}44`, color }}>
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
                {!p.canWrite && identity && (
                  <p className="text-xs text-text-secondary mt-1">
                    {/* Template string, not JSX text: the space after {p.label} gets
                        swallowed in the compiled output (SM5). */}
                    {`Read-only – ${p.label} doesn’t support adding to wishlist via API`}
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
          <h2 className="font-serif text-serif-md text-text-primary">Add login method</h2>
          {getIdentity("trakt") && getIdentity("steam") && getIdentity("rawg") ? (
            <p className="text-sm text-text-secondary">All available login methods are connected — any of them can sign you in.</p>
          ) : (
          <>
          <p className="text-sm text-text-secondary">Connect another account to log in with it in the future.</p>
          {/*
            <a>, not <Link>: these hand off to an OAuth endpoint and Link would
            client-side navigate, breaking the redirect. The rule fires only
            because P13's `/[type]/[id]/[slug]` makes 3-segment paths look like
            pages to the linter; the static /api route still wins at runtime.
          */}
          <div className="flex gap-3 flex-wrap">
            {!getIdentity("trakt") && (
              // eslint-disable-next-line @next/next/no-html-link-for-pages
              <a href="/api/auth/trakt" className="text-sm px-4 py-2 rounded-lg transition-colors"
                style={{ background: "#ed1c2415", border: "1px solid #ed1c2430", color: "#ed1c24" }}>
                Connect Trakt
              </a>
            )}
            {/* Letterboxd hidden until an API key is available — re-add when ready. */}
            {!getIdentity("steam") && (
              // eslint-disable-next-line @next/next/no-html-link-for-pages
              <a href="/api/auth/steam" className="text-sm px-4 py-2 rounded-lg transition-colors"
                style={{ background: "#1b9af715", border: "1px solid #1b9af730", color: "#1b9af7" }}>
                Connect Steam
              </a>
            )}
            {!getIdentity("rawg") && (
              <button onClick={() => setShowRawgForm(true)} className="text-sm px-4 py-2 rounded-lg transition-colors"
                style={{ background: "#4ade8015", border: "1px solid #4ade8030", color: "#4ade80" }}>
                Connect RAWG
              </button>
            )}
          </div>
          </>
          )}
        </section>

        {/* Region (T22) */}
        <section className="space-y-3">
          <h2 className="font-serif text-serif-md text-text-primary">Region</h2>
          <p className="text-sm text-text-secondary">Controls which release dates and streaming availability you see.</p>
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

        {/* Account info */}
        <section className="space-y-3">
          <h2 className="font-serif text-serif-md text-text-primary">Account</h2>
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
          <h2 className="font-serif text-serif-md text-text-primary">Your data</h2>

          <div className="bg-surface-elevated border border-border rounded-xl p-5 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="font-medium text-sm text-text-primary">Download your data</p>
              <p className="text-xs text-text-secondary">
                Everything Fandex stores about you — library, wishlist, ratings and connected accounts — as a JSON file.
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

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <SettingsContent />
    </Suspense>
  );
}
