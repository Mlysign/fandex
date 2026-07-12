import { NextRequest, NextResponse } from "next/server";
import { BoundedCache } from "./boundedCache";

// In-process rate limiting (S3/P7). Single-instance only (P1 = one long-lived
// Node process), so a plain in-memory counter is correct and shared across all
// route handlers. If the app ever goes multi-instance, this moves to a shared
// store (Redis) — see P1b.
//
// Fixed-window counter: not perfectly smooth, but cheap and enough to blunt
// password brute-force and third-party-key-proxy abuse on one node. The bucket
// store is bounded (a flood of distinct IPs can't grow it without limit) with a
// TTL that evicts idle keys.

interface Bucket {
  count: number;
  resetAt: number;
}

const _buckets = new BoundedCache<string, Bucket>({ max: 20000, ttlMs: 60 * 60 * 1000 });

export interface RateDecision {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export function rateLimit(key: string, limit: number, windowMs: number): RateDecision {
  const now = Date.now();
  const b = _buckets.get(key);
  if (!b || now >= b.resetAt) {
    _buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterMs: 0 };
  }
  if (b.count >= limit) {
    return { allowed: false, remaining: 0, retryAfterMs: b.resetAt - now };
  }
  b.count++;
  return { allowed: true, remaining: limit - b.count, retryAfterMs: 0 };
}

// Client IP behind Railway's proxy: the first hop of X-Forwarded-For (the real
// client), falling back to X-Real-IP. "unknown" groups un-attributable requests
// together — acceptable, since it only over-restricts an already-anomalous case.
export function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

// Enforce a limit for `key`; returns a ready-to-send 429 (with Retry-After) when
// exceeded, or null when the request may proceed.
export function enforceRateLimit(key: string, limit: number, windowMs: number): NextResponse | null {
  const d = rateLimit(key, limit, windowMs);
  if (d.allowed) return null;
  const retryAfter = Math.max(1, Math.ceil(d.retryAfterMs / 1000));
  return NextResponse.json(
    { error: "Too many requests. Please slow down and try again shortly." },
    { status: 429, headers: { "Retry-After": String(retryAfter) } }
  );
}
