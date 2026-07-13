import { describe, it, expect } from "vitest";
import { parseCspReport } from "./cspReport";

describe("parseCspReport", () => {
  it("parses the legacy report-uri shape", () => {
    const r = parseCspReport({
      "csp-report": {
        "document-uri": "https://app/detail",
        "violated-directive": "img-src",
        "blocked-uri": "https://evil.example/x.png",
      },
    });
    expect(r).toEqual({
      documentUri: "https://app/detail",
      violatedDirective: "img-src",
      blockedUri: "https://evil.example/x.png",
    });
  });

  it("parses the newer report-to / Reporting-API shape", () => {
    const r = parseCspReport({
      body: { documentURL: "https://app/", effectiveDirective: "script-src", blockedURL: "inline" },
    });
    expect(r).toEqual({ documentUri: "https://app/", violatedDirective: "script-src", blockedUri: "inline" });
  });

  it("truncates over-long untrusted strings and drops non-strings", () => {
    const long = "x".repeat(1000);
    const r = parseCspReport({ "csp-report": { "document-uri": long, "blocked-uri": 123 } });
    expect(r.documentUri?.length).toBe(500);
    expect(r.blockedUri).toBeUndefined();
  });

  it("never throws on junk input", () => {
    expect(() => parseCspReport(null)).not.toThrow();
    expect(() => parseCspReport("nonsense")).not.toThrow();
    expect(parseCspReport({})).toEqual({ documentUri: undefined, violatedDirective: undefined, blockedUri: undefined });
  });
});
