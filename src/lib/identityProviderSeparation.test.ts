import { describe, it, expect } from "vitest";
import { zSource, zAuthProvider, DisconnectPostSchema } from "./schemas";
import { IDENTITY_ONLY_PROVIDERS } from "./syncClient";

// `AuthProvider` is a SUPERSET of `Source`, and collapsing the two is the bug
// this file exists to stop. `Source` is "a place MEDIA comes from" — every value
// in it is legal as a store link, a release date and an `/api/sync` target.
// `AuthProvider` is "a thing that can log you in", which also covers providers
// that hold no library and never sync.
//
// Two identity-only providers exist: google (2026-09-01) and discord
// (2026-09-02). Adding a third means adding it in three places — the type union,
// this enum, and IDENTITY_ONLY_PROVIDERS — and the failure for each omission is
// different and silent. These assert all three agree.

const IDENTITY_ONLY = ["google", "discord"] as const;

describe("an identity-only provider is never a media Source", () => {
  it.each(IDENTITY_ONLY)("rejects %s as a Source", (p) => {
    // The load-bearing one. If it parsed here it would be legal as a store link,
    // as a release-date source, and as an /api/sync target — the last of which
    // would queue a sync against a provider with no adapter.
    expect(zSource.safeParse(p).success).toBe(false);
  });

  it.each(IDENTITY_ONLY)("accepts %s as an AuthProvider", (p) => {
    expect(zAuthProvider.safeParse(p).success).toBe(true);
  });

  it.each(IDENTITY_ONLY)("accepts %s on the disconnect route, which acts on user_identities", (p) => {
    // zSource here would 400 a disconnect and leave the account unable to
    // detach the identity it signed up with.
    expect(DisconnectPostSchema.safeParse({ provider: p }).success).toBe(true);
  });

  it("still accepts every real source as both", () => {
    for (const s of zSource.options) {
      expect(zAuthProvider.safeParse(s).success).toBe(true);
    }
  });
});

describe("the three lists agree", () => {
  it("lists every identity-only provider in IDENTITY_ONLY_PROVIDERS", () => {
    // Without the entry, `staleProviders` reads "no sync_log row" as "overdue",
    // which is right for a provider that CAN sync and permanently wrong for one
    // that cannot: due forever, firing a doomed sync on every /library load.
    for (const p of IDENTITY_ONLY) {
      expect(IDENTITY_ONLY_PROVIDERS).toContain(p);
    }
  });

  it("has every IDENTITY_ONLY_PROVIDERS entry parse as an AuthProvider", () => {
    // rawg is in that list for a DIFFERENT reason (it was retired as a source
    // 2026-09-02 while identities still reference it) and is still a Source, so
    // this asserts the weaker property that holds for both reasons.
    for (const p of IDENTITY_ONLY_PROVIDERS) {
      expect(zAuthProvider.safeParse(p).success).toBe(true);
    }
  });
});
