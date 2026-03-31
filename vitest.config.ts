import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["packages/*/tests/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
