import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "tests/unit/**/*.test.{ts,tsx}",
      "scripts/ocr/tests/**/*.test.{ts,tsx}",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["scripts/**/*.mjs"],
      exclude: ["scripts/**/tests/**"],
      // Baseline measured 56.2 stmts / 78.2 branch / 61.2 funcs; keep a small margin.
      thresholds: {
        statements: 55,
        branches: 75,
        functions: 60,
        lines: 55,
      },
    },
  },
});
