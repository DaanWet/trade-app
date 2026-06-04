import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "./app";
import {
  _resetRateLimitMonitor,
  markLimited,
  markRecovered,
} from "./services/rateLimitMonitor";

beforeEach(() => _resetRateLimitMonitor());
afterEach(() => _resetRateLimitMonitor());

describe("X-Rate-Limited response header", () => {
  it("is absent when no provider is limited", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.headers["x-rate-limited"]).toBeUndefined();
  });

  it("tags responses while a provider is rate-limited", async () => {
    markLimited("yahoo");
    const res = await request(app).get("/api/health");
    expect(res.headers["x-rate-limited"]).toBe("yahoo");
  });

  it("lists multiple limited providers comma-separated", async () => {
    markLimited("yahoo");
    markLimited("frankfurter");
    const res = await request(app).get("/api/health");
    expect(res.headers["x-rate-limited"].split(",").sort()).toEqual(["frankfurter", "yahoo"]);
  });

  it("drops the header again once the provider recovers (a later successful call)", async () => {
    // Recovery is always a strictly-later call than the 429; use a deterministic clock
    // (within the safety-net ceiling) so the clear is from recovery, not from expiry.
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(1_000);
    markLimited("yahoo");
    now.mockReturnValue(2_000);
    markRecovered("yahoo");
    const res = await request(app).get("/api/health");
    now.mockRestore();
    expect(res.headers["x-rate-limited"]).toBeUndefined();
  });

  it("exposes the same state on GET /api/status", async () => {
    markLimited("yahoo");
    const res = await request(app).get("/api/status");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ rateLimited: ["yahoo"] });
  });
});
