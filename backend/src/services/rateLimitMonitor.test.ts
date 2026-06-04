import { afterEach, describe, expect, it, vi } from "vitest";
import {
  _resetRateLimitMonitor,
  getActiveLimited,
  isRateLimitError,
  markLimited,
  markRecovered,
} from "./rateLimitMonitor";

afterEach(() => {
  _resetRateLimitMonitor();
  vi.useRealTimers();
});

describe("isRateLimitError", () => {
  it("detects a yahoo-finance2 v3 HTTPError (status on .code)", () => {
    const err = Object.assign(new Error("Edge: Too Many Requests"), { code: 429 });
    expect(isRateLimitError(err)).toBe(true);
  });

  it("detects a Frankfurter 429 error message", () => {
    expect(isRateLimitError(new Error("Frankfurter 429 on https://api.frankfurter.dev/v1/latest"))).toBe(true);
  });

  it("detects a status-less 'Too Many Requests' message", () => {
    expect(isRateLimitError(new Error("Too Many Requests"))).toBe(true);
  });

  it("ignores non-rate-limit errors", () => {
    expect(isRateLimitError(Object.assign(new Error("boom"), { code: "ETIMEDOUT" }))).toBe(false);
    expect(isRateLimitError(new Error("getaddrinfo ENOTFOUND"))).toBe(false);
    expect(isRateLimitError(null)).toBe(false);
    expect(isRateLimitError(undefined)).toBe(false);
  });
});

describe("rate-limit monitor", () => {
  it("reports a provider as limited after a 429", () => {
    markLimited("yahoo");
    expect(getActiveLimited()).toEqual(["yahoo"]);
  });

  it("clears on evidence of recovery (a later successful call)", () => {
    vi.useFakeTimers();
    markLimited("yahoo");
    expect(getActiveLimited()).toEqual(["yahoo"]);
    vi.advanceTimersByTime(1000);
    markRecovered("yahoo");
    expect(getActiveLimited()).toEqual([]);
  });

  it("stays limited when a 429 is newer than the last success", () => {
    vi.useFakeTimers();
    markRecovered("yahoo");
    vi.advanceTimersByTime(1000);
    markLimited("yahoo");
    expect(getActiveLimited()).toEqual(["yahoo"]);
  });

  it("tracks providers independently", () => {
    markLimited("yahoo");
    markLimited("frankfurter");
    expect([...getActiveLimited()].sort()).toEqual(["frankfurter", "yahoo"]);
  });

  it("expires via the safety-net ceiling when no recovery ever follows", () => {
    vi.useFakeTimers();
    markLimited("yahoo");
    expect(getActiveLimited()).toEqual(["yahoo"]);
    vi.advanceTimersByTime(11 * 60 * 1000); // past the ~10 min ceiling
    expect(getActiveLimited()).toEqual([]);
  });
});
