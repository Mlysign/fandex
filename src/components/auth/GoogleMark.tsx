// The Google "G", in Google's own colours. The ONE mark on this site that is
// not monochrome, and the exception is required rather than chosen.
//
// Everywhere else, a provider is drawn by <BrandGlyph> in the UI's own text
// colour, because "no brand hue in ANY state" is a standing rule here
// (2026-08-18, → components/BrandGlyph.tsx). Google's Sign in with Google
// branding guidelines contradict that rule directly, and they are not advisory:
//
//   "Your website or app must follow these guidelines to complete the app
//    verification process."
//   Don't: "Use monochrome versions of the Google 'G' for the button."
//   "Regardless of the text, you can't change the size or color of the Google
//    'G' logo. It must be the standard color version."
//
// So a monochrome G is not a house-style variation on a Google button, it is a
// documented violation that can block the verification the sign-in needs anyway.
// Nils's call, 2026-09-01: "if its google policy, then use the colored G."
//
// ⚠️ The guidelines ALSO say the G must not sit on a coloured background, but
// light, dark and neutral surfaces are explicitly fine ("Don't: Put the standard
// color Google 'G' icon on a colored background OTHER THAN light, dark, or
// neutral"). Our button surfaces are neutral in both themes, so the mark goes
// straight on them and needs no white tile. ⚠️ Read the ENGLISH page for this:
// the German translation drops the "other than" and inverts the rule.
// → https://developers.google.com/identity/branding-guidelines?hl=en
//
// The four paths are the standard colour "G" as Google ships it. Do not recolour
// them, do not add a hover state, and do not pass a className that sets `color` —
// each path carries its own literal fill for exactly that reason.
//
// NOT in lib/brandMarks.ts on purpose: that file is generated from simple-icons,
// whose Google entry is a single monochrome path, and everything reading it
// renders in `currentColor`. A test (brandMarksNoGoogle.test.ts) fails if a
// "Google" key reappears there, because the failure mode is silent — a
// monochrome G looks perfectly fine and is a compliance breach.
export default function GoogleMark({ size = 18 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 48 48"
      // aria-hidden for the same reason as BrandGlyph: every call site renders
      // "Google" in text right beside it, so announcing it twice is worse.
      aria-hidden="true"
      focusable="false"
      // Locks the aspect ratio. The guidelines allow scaling but require the
      // logo is never stretched.
      preserveAspectRatio="xMidYMid meet"
      style={{ flexShrink: 0 }}
    >
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
