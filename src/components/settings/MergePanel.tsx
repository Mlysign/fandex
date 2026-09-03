"use client";
import { useEffect, useState } from "react";
import PanelHeader from "@/components/insights/PanelHeader";
import Button from "@/components/ui/Button";
import BrandGlyph from "@/components/BrandGlyph";

// The merge decision form (2026-09-02, Nils: "it should give me a merge form for
// me to decide and then execute the merge right after").
//
// It appears when connecting a provider turns out to link an account that also
// has titles saved. Everything that does NOT overlap moves either way — that half
// needs no decision. This panel is only about the rows where both accounts have
// something for the same title.
//
// ⚠️ NO OPTION IS PRESELECTED, and that is the point. A default would be the
// silent winner-picking that the whole flow exists to replace, and it would be
// the easiest thing in the world to click past.

interface Side {
  displayName: string | null;
  provider: string | null;
  providers: string[];
  titles: number;
  episodes: number;
}

interface Pending {
  provider: string;
  mine: Side;
  theirs: Side;
  conflicts: { itemState: number; episodeState: number; cleanRows: number; sampleTitles: string[] };
}

function SideCard({ side, label }: { side: Side; label: string }) {
  return (
    <div className="flex-1 min-w-0 bg-surface-inset border border-border rounded-lg p-4">
      <p className="text-caption text-text-secondary uppercase tracking-wide mb-1">{label}</p>
      <div className="flex items-center gap-2 min-w-0 mb-2">
        {side.provider && <BrandGlyph source={side.provider} size={15} />}
        <p className="font-medium text-sm text-text-primary truncate">
          {side.displayName ?? side.provider ?? "This account"}
        </p>
      </div>
      <p className="text-xs text-text-secondary">
        {side.titles} {side.titles === 1 ? "title" : "titles"}
        {side.episodes > 0 && `, ${side.episodes} episodes`}
      </p>
      {side.providers.length > 0 && (
        <p className="text-xs text-text-muted mt-1 truncate">{side.providers.join(", ")}</p>
      )}
    </div>
  );
}

export default function MergePanel({ onDone }: { onDone: (msg: string) => void }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch-on-mount: the pending merge lives in an httpOnly cookie, so only the
  // server can see it. Same justified disable the other session-reading islands
  // in this app use.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    fetch("/api/account/merge")
      .then((r) => r.json())
      .then((d) => { setPending(d.pending ?? null); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading || !pending) return null;

  const { conflicts, mine, theirs } = pending;

  async function choose(resolution: "keep-mine" | "keep-theirs") {
    setBusy(resolution);
    setError(null);
    const res = await fetch("/api/account/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolution }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      setError(data.error === "provider-taken"
        ? `Both accounts sign in with ${data.provider}. Disconnect it on one of them first.`
        : (data.error ?? "Merge failed. Nothing was changed."));
      return;
    }
    setPending(null);
    // A full reload, not a client refresh: the session cookie now points at a
    // DIFFERENT user, and every cached client read (the session probe, the
    // platform list, every list surface) belongs to the account that just went
    // away. Reloading is the honest way to start again as the survivor.
    onDone("The accounts are now one.");
    window.location.href = "/settings?merged=1";
  }

  return (
    <section className="space-y-3">
      <PanelHeader
        eyebrow="Join these accounts"
        hint={`The ${pending.provider} account you just connected belongs to another Fandex account. Both have titles saved, so you decide what wins.`}
      />
      <div className="bg-surface-elevated border border-warning/40 rounded-xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <SideCard side={mine} label="Signed in as" />
          <SideCard side={theirs} label="The other account" />
        </div>

        <div className="text-sm text-text-secondary space-y-1">
          <p>
            <strong className="text-text-primary">{conflicts.cleanRows}</strong>{" "}
            {conflicts.cleanRows === 1 ? "entry moves" : "entries move"} across with nothing to decide.
          </p>
          <p>
            <strong className="text-text-primary">
              {conflicts.itemState + conflicts.episodeState}
            </strong>{" "}
            {conflicts.itemState + conflicts.episodeState === 1 ? "entry exists" : "entries exist"} on
            both accounts. Pick which copy to keep for those.
          </p>
          {conflicts.sampleTitles.length > 0 && (
            <p className="text-xs text-text-muted">
              For example: {conflicts.sampleTitles.join(", ")}
              {conflicts.itemState > conflicts.sampleTitles.length && ", and others"}.
            </p>
          )}
        </div>

        {error && <p className="text-caption text-danger">{error}</p>}

        <div className="flex flex-col sm:flex-row gap-2">
          <Button onClick={() => choose("keep-mine")} disabled={!!busy} loading={busy === "keep-mine"}>
            Keep this account&apos;s copies
          </Button>
          <Button onClick={() => choose("keep-theirs")} disabled={!!busy} loading={busy === "keep-theirs"}>
            Keep the other account&apos;s copies
          </Button>
        </div>
        <p className="text-xs text-text-muted">
          Either way both accounts become one and nothing else is lost. Only the overlapping
          entries above are affected.
        </p>
      </div>
    </section>
  );
}
