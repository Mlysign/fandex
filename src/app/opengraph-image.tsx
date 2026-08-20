import { ImageResponse } from "next/og";

// P12 — dynamic Open Graph / Twitter card image (1200×630). Next wires this file
// convention into both openGraph.images and twitter.images automatically.
// Deliberately simple (satori supports flexbox + a CSS subset only).

// Keep this in step with layout.tsx's TITLE.
export const alt = "Fandex: your index of every game, movie & show";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const TAGLINE = "Your index of every game, movie & show.";

export default function Image() {
  return new ImageResponse(
    (
      // 2026-07-27 — Direction 2a "Ticket · Calm": the app's own dark surface
      // + the brass accent, replacing the old indigo→violet gradient (a color
      // pair in no Ticket·Calm token, same root issue as the old app icon and
      // in-app logo). Satori (this renderer) has no access to the self-hosted
      // DM Serif Display, so the wordmark stays sans — bold weight carries
      // the brand voice here instead.
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#100E0C",
          color: "#EDE7DC",
          fontFamily: "sans-serif",
          padding: "0 100px",
        }}
      >
        <div style={{ display: "flex", position: "relative", width: 96, height: 96, marginBottom: 36 }}>
          <div style={{ display: "flex", position: "absolute", left: 0, top: 14, width: 66, height: 74, borderRadius: 15, background: "#a78bfa", transform: "rotate(-9deg)" }} />
          <div style={{ display: "flex", position: "absolute", left: 26, top: 0, width: 66, height: 74, borderRadius: 15, background: "#C8A24B", border: "3px solid #100E0C" }} />
        </div>
        <div style={{ display: "flex", fontSize: 108, fontWeight: 800, letterSpacing: "-3px" }}>
          Fandex
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 38,
            color: "#9A8F80",
            marginTop: 28,
            textAlign: "center",
            lineHeight: 1.3,
          }}
        >
          {TAGLINE}
        </div>
      </div>
    ),
    size,
  );
}
