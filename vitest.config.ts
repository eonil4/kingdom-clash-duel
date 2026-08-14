import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "tests/unit/**/*.test.{ts,tsx}",
      "scripts/ocr/tests/**/*.test.{ts,tsx}",
    ],
  },
});
