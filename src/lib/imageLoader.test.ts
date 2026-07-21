import { describe, it, expect } from "vitest";
import cdnImageLoader, { cdnImageUrl } from "./imageLoader";

// The bucket values here are not arbitrary — each was verified against the live
// CDN before being hard-coded (PR10). If one of these ever 404s in production,
// re-verify with curl rather than guessing a replacement.
describe("cdnImageUrl", () => {
  describe("TMDB", () => {
    const src = "https://image.tmdb.org/t/p/w500/tuKBvLH4YWumvPZLKaGsMtDoNgX.jpg";

    // Rounds DOWN — see floorBucket(): next/image already asks for DPR-inflated
    // widths, and TMDB serves heavy JPEG, so rounding up is what costs bytes.
    it("rounds down to the largest bucket the request covers", () => {
      expect(cdnImageUrl(src, 200)).toBe("https://image.tmdb.org/t/p/w185/tuKBvLH4YWumvPZLKaGsMtDoNgX.jpg");
      expect(cdnImageUrl(src, 500)).toBe("https://image.tmdb.org/t/p/w500/tuKBvLH4YWumvPZLKaGsMtDoNgX.jpg");
      expect(cdnImageUrl(src, 700)).toBe("https://image.tmdb.org/t/p/w500/tuKBvLH4YWumvPZLKaGsMtDoNgX.jpg");
    });

    it("never drops below the smallest bucket", () => {
      expect(cdnImageUrl(src, 48)).toBe("https://image.tmdb.org/t/p/w92/tuKBvLH4YWumvPZLKaGsMtDoNgX.jpg");
      expect(cdnImageUrl(src, 16)).toBe("https://image.tmdb.org/t/p/w92/tuKBvLH4YWumvPZLKaGsMtDoNgX.jpg");
    });

    it("can upgrade past the stored size (TMDB serves any bucket from one path)", () => {
      expect(cdnImageUrl(src, 828)).toBe("https://image.tmdb.org/t/p/w780/tuKBvLH4YWumvPZLKaGsMtDoNgX.jpg");
    });

    it("caps at w780 rather than falling through to `original`", () => {
      expect(cdnImageUrl(src, 1080)).toContain("/t/p/w780/");
      expect(cdnImageUrl(src, 4000)).toContain("/t/p/w780/");
    });

    it("rewrites non-poster size segments too (profile/logo paths)", () => {
      expect(cdnImageUrl("https://image.tmdb.org/t/p/w45/logo.png", 96)).toBe(
        "https://image.tmdb.org/t/p/w92/logo.png"
      );
      expect(cdnImageUrl("https://image.tmdb.org/t/p/original/x.jpg", 342)).toBe(
        "https://image.tmdb.org/t/p/w342/x.jpg"
      );
    });
  });

  describe("RAWG", () => {
    // The whole reason PR10 exists: these are stored as full-size originals.
    const src = "https://media.rawg.io/media/games/b51/b51c3649322ac0de9dfbe83435eda449.jpg";

    // Rounds UP, unlike TMDB — the fallback here is a multi-MB original, so
    // every bucket is already a >10x win and sharpness is the better trade.
    it("inserts a resize segment sized to the request", () => {
      expect(cdnImageUrl(src, 64)).toBe(
        "https://media.rawg.io/media/resize/200/-/games/b51/b51c3649322ac0de9dfbe83435eda449.jpg"
      );
      expect(cdnImageUrl(src, 420)).toBe(
        "https://media.rawg.io/media/resize/420/-/games/b51/b51c3649322ac0de9dfbe83435eda449.jpg"
      );
      expect(cdnImageUrl(src, 500)).toContain("/media/resize/640/-/");
      expect(cdnImageUrl(src, 1080)).toContain("/media/resize/1280/-/");
      expect(cdnImageUrl(src, 4000)).toContain("/media/resize/1280/-/");
    });

    it("handles screenshot paths, not just /games/", () => {
      expect(cdnImageUrl("https://media.rawg.io/media/screenshots/266/abc.jpg", 200)).toBe(
        "https://media.rawg.io/media/resize/200/-/screenshots/266/abc.jpg"
      );
    });

    it("never stacks a second transform on an already-sized URL", () => {
      const sized = "https://media.rawg.io/media/resize/420/-/games/b51/x.jpg";
      const cropped = "https://media.rawg.io/media/crop/600/400/games/b51/x.jpg";
      expect(cdnImageUrl(sized, 64)).toBe(sized);
      expect(cdnImageUrl(cropped, 64)).toBe(cropped);
    });
  });

  describe("IGDB", () => {
    const src = "https://images.igdb.com/igdb/image/upload/t_cover_big/co1r7f.jpg";

    it("swaps the size token", () => {
      expect(cdnImageUrl(src, 64)).toBe("https://images.igdb.com/igdb/image/upload/t_thumb/co1r7f.jpg");
      expect(cdnImageUrl(src, 200)).toBe("https://images.igdb.com/igdb/image/upload/t_cover_big/co1r7f.jpg");
      expect(cdnImageUrl(src, 400)).toBe("https://images.igdb.com/igdb/image/upload/t_cover_big_2x/co1r7f.jpg");
      expect(cdnImageUrl(src, 2000)).toBe("https://images.igdb.com/igdb/image/upload/t_1080p/co1r7f.jpg");
    });
  });

  describe("passthrough", () => {
    it("leaves Steam capsules alone (already fixed-size assets)", () => {
      const steam = "https://cdn.akamai.steamstatic.com/steam/apps/4680720/header.jpg";
      expect(cdnImageUrl(steam, 200)).toBe(steam);
    });

    it("leaves local, data: and unknown-host URLs alone", () => {
      expect(cdnImageUrl("/icon-192.png", 192)).toBe("/icon-192.png");
      expect(cdnImageUrl("data:image/png;base64,AAAA", 32)).toBe("data:image/png;base64,AAAA");
      expect(cdnImageUrl("https://example.com/x.jpg", 32)).toBe("https://example.com/x.jpg");
    });

    it("does not rewrite a lookalike host", () => {
      const evil = "https://image.tmdb.org.evil.example/t/p/w500/x.jpg";
      expect(cdnImageUrl(evil, 200)).toBe(evil);
    });
  });

  it("default export is the next/image loader shape", () => {
    expect(cdnImageLoader({ src: "https://image.tmdb.org/t/p/w500/x.jpg", width: 342, quality: 75 })).toBe(
      "https://image.tmdb.org/t/p/w342/x.jpg"
    );
  });
});
