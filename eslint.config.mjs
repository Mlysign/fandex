import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 2026-07-30 — `npm run lint` runs plain `eslint` with no path filter, and
    // flat config's ignores are the only thing standing between that and
    // scanning EVERY nested directory under the repo root, gitignored or not.
    // A `git worktree add` under .claude/worktrees/ (isolation:"worktree" agent
    // runs use this) checks out a full second copy of the source tree there —
    // found live when an abandoned worktree from an unrelated prior session
    // (checked out at an old commit, predating this very rule) surfaced 200+
    // stale "errors" against code nobody was editing. Ignoring it here doesn't
    // touch or delete that worktree, which may be another session's own
    // in-progress work — it just stops lint from scanning it.
    ".claude/worktrees/**",
    // 2026-08-02 — same class of bug, found by a doc-hygiene pass. `81493db`
    // added `npm run dev:alt` (NEXT_DIST_DIR=.next-alt, port 3010) so two
    // concurrent `next dev` processes stop corrupting each other's build, and
    // gitignored the directory — but gitignoring is exactly what does NOT
    // matter here, per the note above. The result: the moment anyone ran
    // dev:alt, `npm run lint` scanned Turbopack's emitted chunks and reported
    // ~735 errors (require() imports, @ts-ignore, module assignment,
    // this-aliasing) against generated code, silently breaking the repo's
    // standing "0 errors" bar. Any future alternate distDir needs a line here.
    ".next-alt/**",
  ]),
  {
    rules: {
      // The app parses untyped third-party API JSON throughout (every source
      // adapter / merge normalizer), so `any` is a deliberate, pervasive choice
      // here, not a code-smell. Kept as a warning (visible, not blocking) so the
      // genuinely actionable errors — react-hooks correctness, etc. — aren't
      // drowned out in lint output.
      "@typescript-eslint/no-explicit-any": "warn",
      // 2026-08-03 — an ERROR, because this failure mode is invisible to every
      // other check in the repo. A `// comment` in JSX CHILDREN position is not
      // a comment; it is a text node, and it renders. It happened here for real:
      // `LegalLinks` had a long `//` block sitting legally in `return ( … )`
      // ahead of the root element, and wrapping that return in a fragment moved
      // it into children position — the entire SM33 tap-target note rendered as
      // a paragraph in the site footer. tsc passed, 540 tests passed, lint
      // passed, `next build` passed; it took a human looking at the page.
      // This is the SECOND JSX-comment incident here (see AGENTS.md on
      // `eslint --fix` destroying three `{/* eslint-disable */}` directives in
      // AuthOptions.tsx), which is what makes it worth a rule rather than care.
      "react/jsx-no-comment-textnodes": "error",
      // An ERROR, not a style preference: it guards a real load-time crash.
      // Node's native type-stripping (what scripts/alias-hooks.mjs relies on for
      // every rehearse-*.mjs / calibrate-*.mjs) only erases syntactically
      // type-only constructs. A plain `import { Foo } from "@/types"` where Foo
      // is an interface therefore survives stripping and throws
      //   SyntaxError: does not provide an export named 'Foo'
      // the moment a standalone script reaches that module — while tsc, vitest,
      // next dev and next build all elide it correctly and report nothing. Every
      // export of src/types/index.ts is type-only, so this was latent in ~50
      // files; it cost real debugging time writing calibrate-fandex.mjs
      // (2026-07-29) and was recommended there. Enabled 2026-07-30.
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "separate-type-imports" }],
      // usePersistedState's `normalize` (3rd arg) must be a STABLE reference —
      // its own hydrate effect is keyed on it (see usePersistedState.ts's own
      // comment). An inline arrow/function re-runs that effect every render,
      // which clobbers each state update with the stored value a beat later.
      // This bit MyStuffView.tsx for real (2026-07-28, fixed) — catch it at
      // lint time instead of by browser-testing sort persistence.
      "no-restricted-syntax": [
        "error",
        {
          selector:
            ":matches(CallExpression[callee.name='usePersistedState'][arguments.2.type='ArrowFunctionExpression'], CallExpression[callee.name='usePersistedState'][arguments.2.type='FunctionExpression'])",
          message:
            "usePersistedState's `normalize` (3rd arg) must be a stable reference, not an inline function — a fresh function every render re-runs the hook's hydrate effect and silently reverts state changes. Define it as a module-level function and pass that reference instead.",
        },
      ],
    },
  },
]);

export default eslintConfig;
