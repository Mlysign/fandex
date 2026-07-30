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
  ]),
  {
    rules: {
      // The app parses untyped third-party API JSON throughout (every source
      // adapter / merge normalizer), so `any` is a deliberate, pervasive choice
      // here, not a code-smell. Kept as a warning (visible, not blocking) so the
      // genuinely actionable errors — react-hooks correctness, etc. — aren't
      // drowned out in lint output.
      "@typescript-eslint/no-explicit-any": "warn",
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
