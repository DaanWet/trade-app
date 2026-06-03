import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Every test run uses a throwaway in-memory SQLite DB (set before db.ts loads),
    // so tests never touch the real data/trades.db and start from a clean schema.
    env: { DB_PATH: ":memory:" },
    include: ["src/**/*.test.ts"],
  },
});
