// S6 — parse a browser CSP violation report into a compact, log-safe shape.
// Reports arrive either as the legacy `report-uri` body `{ "csp-report": {...} }`
// or the newer `report-to` Reporting-API shape. The fields are untrusted input,
// so strings are truncated before they reach the logs.

function str(v: unknown, max = 500): string | undefined {
  if (typeof v !== "string" || v.length === 0) return undefined;
  return v.length > max ? v.slice(0, max) : v;
}

export interface CspReport {
  documentUri?: string;
  violatedDirective?: string;
  blockedUri?: string;
}

export function parseCspReport(body: unknown): CspReport {
  const b = (body ?? {}) as Record<string, unknown>;
  // report-uri nests under "csp-report"; report-to sends the body (or its `.body`) directly.
  const r = (b["csp-report"] ?? (b as { body?: unknown }).body ?? b) as Record<string, unknown>;
  return {
    documentUri: str(r["document-uri"] ?? r["documentURL"]),
    violatedDirective: str(r["violated-directive"] ?? r["effectiveDirective"]),
    blockedUri: str(r["blocked-uri"] ?? r["blockedURL"]),
  };
}
