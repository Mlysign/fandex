// One lint run for the whole repo: the shared modules (src/), the Worker
// (worker/) and the app (mobile/). Until 2026-10-23 this linted only the old
// Next.js site, and the two packages that ship had no lint at all.
//
// Only rules that catch a real failure are errors. Style is not linted.
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

export default defineConfig([
  globalIgnores([
    // Gitignored working data. The weekly taxonomy sweep writes a work folder
    // under data/taxonomy-sweep/ and may leave a helper script in it.
    "data/**",
    // `npm run lint` scans every directory under the root, gitignored or not,
    // and flat config's ignores are all that stops it. A `git worktree add`
    // under .claude/worktrees/ is a whole second checkout, possibly another
    // session's live work: never scanned, never deleted.
    ".claude/worktrees/**",
    "**/node_modules/**",
    // The old site's build output, still on disk where it was built.
    ".next*/**",
    // Build output and generated code of the two packages.
    "worker/.wrangler/**",
    "worker/worker-configuration.d.ts",
    "mobile/android/**",
    "mobile/dist/**",
    "mobile/web/dist/**",
    "mobile/.expo/**",
    "mobile/expo-env.d.ts",
  ]),
  // The plugins are known to every file, so a disable comment naming one of
  // their rules (there are hundreds, from when the old site linted with them)
  // is not reported as a rule that does not exist.
  {
    plugins: { "@typescript-eslint": tseslint.plugin, react, "react-hooks": reactHooks },
  },
  {
    files: ["**/*.{ts,tsx,mts}"],
    languageOptions: { parser: tseslint.parser },
    rules: {
      // An ERROR, not a style preference: it guards a real load-time crash.
      // Node's native type-stripping (what scripts/alias-hooks.mjs and the
      // taxonomy sweep's hooks rely on) only erases syntactically type-only
      // constructs. A plain `import { Foo } from "@/types"` where Foo is an
      // interface survives stripping and throws "does not provide an export
      // named 'Foo'" the moment a script reaches that module, while tsc,
      // vitest and every bundler elide it and report nothing.
      // `import("x").T` in a type position is erased like any type, so it is allowed.
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "separate-type-imports", disallowTypeAnnotations: false }],
    },
  },
  {
    files: ["mobile/**/*.tsx", "mobile/**/*.ts"],
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    settings: { react: { version: "19.2" } },
    rules: {
      // An ERROR because nothing else catches it. A `// comment` in JSX
      // CHILDREN position is a text node, and it renders: it happened on the
      // old site, where wrapping a return in a fragment put a whole comment
      // block on the page with tsc, every test and the build green.
      "react/jsx-no-comment-textnodes": "error",
      // A hook called conditionally is a crash on the render that skips it.
      "react-hooks/rules-of-hooks": "error",
      // Visible, not blocking: many effects here leave a dependency out on
      // purpose (a ref, a stable setter), each with a reason in a comment.
      "react-hooks/exhaustive-deps": "warn",
    },
  },
]);
