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
      // Measured 59.7 stmts / 78.7 branch / 64.0 funcs; keep ~2 points of margin.
      thresholds: {
        statements: 58,
        branches: 77,
        functions: 62,
        lines: 58,
      },
    },
  },
});
