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
