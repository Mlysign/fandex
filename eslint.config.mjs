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
    },
  },
]);

export default eslintConfig;
