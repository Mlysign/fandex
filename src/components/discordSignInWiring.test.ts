import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Discord sign-in (2026-09-02) has to be registered in several places, and every
// omission fails DIFFERENTLY and silently. This is the shape of
// brandMarksNoGoogle.test.ts: a rule whose breach renders fine.
//
// The settings page's own `loginMethods` comment predicts the failure this file
// guards: "Was three inlined getIdentity() calls repeated in three places, which
// is how Google would have been added to two of them and missed in the third."
// Discord has exactly the same three places.
//
// Source-read rather than rendered, deliberately: these are module-scope
// `process.env.NEXT_PUBLIC_*` reads that Next inlines at BUILD time, so a render
// test would assert whatever the test environment happened to have set, which is
// the same "asserting the default instead of the behaviour" trap AGENTS.md
// records for env-gated code.

const settings = readFileSync("src/app/settings/SettingsPageClient.tsx", "utf8");
const authOptions = readFileSync("src/components/auth/AuthOptions.tsx", "utf8");
const dockerfile = readFileSync("Dockerfile", "utf8");

describe("the settings page registers Discord in all three places", () => {
  it("adds it to the connected-accounts list, as identity-only", () => {
    // identityOnly suppresses the Sync button. Without it the card offers a
    // control that can only ever no-op, which reads as broken.
    expect(settings).toMatch(/key:\s*"discord"[^}]*identityOnly:\s*true/);
  });

  it("adds it to loginMethods, which drives the 'everything connected' notice", () => {
    expect(settings).toMatch(/discordEnabled\s*\?\s*\["discord"\]/);
  });

  it("adds a Connect button under 'Add login method'", () => {
    expect(settings).toContain('href="/api/auth/discord"');
  });

  it("gates all of it on the same single flag", () => {
    expect(settings).toContain("const discordEnabled = !!process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID");
  });
});

describe("the sign-in dialog offers Discord", () => {
  it("links the start route", () => {
    expect(authOptions).toContain("/api/auth/discord");
  });

  it("uses BrandGlyph, NOT a bespoke coloured mark", () => {
    // Google is the ONE exception to the no-brand-colour rule and it is required
    // rather than chosen. Discord permits a monochrome mark, so it takes the
    // house treatment; a second bespoke mark would quietly reintroduce the
    // fruit-salad the brand-glyph pass removed.
    expect(authOptions).toMatch(/BrandGlyph\s+source="discord"/);
  });

  it("shows the platform divider when EITHER identity provider is on", () => {
    // It used to live inside the Google block, so a deploy with Discord
    // configured and Google not would have rendered the buttons with no divider,
    // making them read as two more platforms to link.
    expect(authOptions).toMatch(/\(googleEnabled \|\| discordEnabled\)/);
  });
});

describe("the Dockerfile declares the public client id", () => {
  it("has the ARG, or the button never renders in production", () => {
    // A NEXT_PUBLIC_ var read by a client component must be present at BUILD
    // time. Without the ARG the route works perfectly and the button is invisible
    // — the exact half-live failure that bit NEXT_PUBLIC_SUPPORT_URL.
    expect(dockerfile).toContain("ARG NEXT_PUBLIC_DISCORD_CLIENT_ID");
    expect(dockerfile).toContain("ENV NEXT_PUBLIC_DISCORD_CLIENT_ID=$NEXT_PUBLIC_DISCORD_CLIENT_ID");
  });

  it("never declares the SECRET there", () => {
    // A build ARG is visible in the image's layer history. The secret is
    // server-only and read at runtime.
    expect(dockerfile).not.toContain("DISCORD_CLIENT_SECRET");
  });
});

describe("both auth routes are request-time", () => {
  it.each(["route", "callback/route"])("src/app/api/auth/discord/%s.ts forces dynamic", (f) => {
    // Next prerenders route handlers at BUILD time without this, and Railway's
    // build-phase env differs from its runtime env — so the wrong origin gets
    // baked into the redirect_uri permanently, status 200 either way.
    const src = readFileSync(`src/app/api/auth/discord/${f}.ts`, "utf8");
    expect(src).toContain('export const dynamic = "force-dynamic"');
  });
});
