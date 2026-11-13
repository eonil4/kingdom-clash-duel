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
      // run-llm-real-test is a manual LM Studio integration script, not unit-testable.
      exclude: ["scripts/**/tests/**", "scripts/llm/run-llm-real-test.mjs"],
      // Measured 93.8 stmts / 82.5 branch / 82.7 funcs; keep ~1 point of margin.
      thresholds: {
        statements: 93,
        branches: 81,
        functions: 81,
        lines: 93,
      },
    },
  },
});
