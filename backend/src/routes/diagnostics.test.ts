import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// Throwaway log dir for this file. The logger reads LOG_DIR fresh per write, so logs
// emitted during the test (below) land here regardless of import ordering.
const TMP = path.join(os.tmpdir(), `tradeapp-diagtest-${process.pid}`);
process.env.LOG_DIR = TMP;

import request from "supertest";
import { app } from "../app";
import { yahoo } from "../services/yahooClient";
import { getLogFilePath, _resetLogBuffer } from "../helpers/logger";

beforeEach(() => {
  _resetLogBuffer();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("a swallowed provider failure is observable", () => {
  it("logs a failed yahoo.search to file and surfaces it on GET /api/diagnostics", async () => {
    // Force the shared yahoo singleton's search to throw — the provider swallows it.
    vi.spyOn(yahoo, "search").mockRejectedValue(new Error("Edge: Too Many Requests"));

    const search = await request(app).get("/api/prices/search?q=APPL");
    // Behaviour preserved: the failure is swallowed and the endpoint returns [].
    expect(search.status).toBe(200);
    expect(search.body).toEqual([]);

    // (a) The failure landed in the log file in LOG_DIR (survives a restart).
    const fileContents = fs.readFileSync(getLogFilePath(), "utf8");
    expect(fileContents).toContain("[yahooPrice] search");

    // (b) The failure is retrievable via the diagnostics endpoint (no user interaction).
    const diag = await request(app).get("/api/diagnostics");
    expect(diag.status).toBe(200);
    const events = diag.body.recentEvents as Array<{ component: string; level: string }>;
    const found = events.find((e) => e.component === "yahooPrice");
    expect(found).toBeTruthy();
    expect(found?.level).toBe("warn");
  });
});
