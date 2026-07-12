import { describe, it, expect } from "vitest";
import { sanitizePosterUrl } from "./posterUrl";

// S12: only https URLs on trusted media-CDN hosts may be stored/reflected.

describe("sanitizePosterUrl", () => {
  it("accepts https URLs on allowed CDN hosts", () => {
    expect(sanitizePosterUrl("https://image.tmdb.org/t/p/w500/abc.jpg")).toBe(
      "https://image.tmdb.org/t/p/w500/abc.jpg"
    );
    expect(sanitizePosterUrl("https://media.rawg.io/media/games/x.jpg")).toBeTruthy();
    expect(sanitizePosterUrl("https://images.igdb.com/igdb/image/upload/t_cover_big/x.jpg")).toBeTruthy();
    expect(sanitizePosterUrl("https://cdn.akamai.steamstatic.com/steam/apps/1/header.jpg")).toBeTruthy();
    expect(sanitizePosterUrl("https://shared.fastly.steamstatic.com/store_item_assets/x.jpg")).toBeTruthy();
  });

  it("rejects non-https protocols", () => {
    expect(sanitizePosterUrl("http://image.tmdb.org/x.jpg")).toBeNull();
    expect(sanitizePosterUrl("javascript:alert(1)")).toBeNull();
    expect(sanitizePosterUrl("data:image/png;base64,AAAA")).toBeNull();
  });

  it("rejects disallowed hosts (incl. lookalikes)", () => {
    expect(sanitizePosterUrl("https://evil.com/x.jpg")).toBeNull();
    expect(sanitizePosterUrl("https://image.tmdb.org.evil.com/x.jpg")).toBeNull();
    expect(sanitizePosterUrl("https://notsteamstatic.com/x.jpg")).toBeNull();
  });

  it("rejects non-string / empty / malformed input", () => {
    expect(sanitizePosterUrl(null)).toBeNull();
    expect(sanitizePosterUrl(undefined)).toBeNull();
    expect(sanitizePosterUrl(42)).toBeNull();
    expect(sanitizePosterUrl("")).toBeNull();
    expect(sanitizePosterUrl("not a url")).toBeNull();
  });
});
