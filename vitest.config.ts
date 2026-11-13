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
      // Measured 81.0 stmts / 81.1 branch / 80.3 funcs; keep ~1 point of margin.
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 79,
        lines: 80,
      },
    },
  },
});
