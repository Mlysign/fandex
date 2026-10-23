import { defineConfig } from "vitest/config";
import path from "path";

// The shared modules in src/lib, which the Worker and the app import. The two
// packages run their own suites (worker/, mobile/).
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.ts"],
  },
});
