import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { logger } from "./helpers/logger";
import { runMigrations } from "./schema";

describe("runMigrations", () => {
  it("adds the article preview columns in migration 6 and is idempotent", () => {
    vi.spyOn(logger, "info").mockImplementation(() => {});
    const mem = new Database(":memory:");

    runMigrations(mem);
    runMigrations(mem);

    const cols = (mem.prepare("PRAGMA table_info(news_articles)").all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(cols).toEqual(expect.arrayContaining(["image_url", "summary", "preview_at"]));
    const { v } = mem.prepare("SELECT MAX(version) AS v FROM schema_version").get() as { v: number };
    expect(v).toBe(6);
  });
});
