import { NextResponse } from "next/server";

// P15 — Digital Asset Links. Lets the Play Store TWA prove it owns this origin so
// Android drops the in-app browser address bar. Google's verifier fetches this at
// /.well-known/assetlinks.json (server-side, so the CSP doesn't apply).
//
// Values come from the SIGNED Android app — set these on the host once the TWA is
// built/signed (see the P14/P15 notes):
//   TWA_PACKAGE_NAME     e.g. org.fandex.twa
//   TWA_CERT_FINGERPRINT the signing cert's SHA-256, colon-separated hex
//                        (comma-separate multiple, e.g. upload + Play App Signing keys)
// Until both are set, this serves an empty list — valid JSON, no verification yet.
export function GET() {
  const pkg = process.env.TWA_PACKAGE_NAME?.trim();
  const fingerprints = (process.env.TWA_CERT_FINGERPRINT ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const body =
    pkg && fingerprints.length > 0
      ? [
          {
            relation: ["delegate_permission/common.handle_all_urls"],
            target: {
              namespace: "android_app",
              package_name: pkg,
              sha256_cert_fingerprints: fingerprints,
            },
          },
        ]
      : [];

  return NextResponse.json(body);
}
