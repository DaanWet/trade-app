import { beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../helpers/logger";
import {
  ESCALATE_AFTER,
  getProviderFailures,
  recordFailure,
  recordSuccess,
  _resetProviderHealth,
} from "./providerHealth";

/**
 * Provider failures are logged as warnings, and the Sentry sink turns warnings into
 * breadcrumbs that are only transmitted alongside a captured error. A provider that fails
 * silently for weeks therefore produced no remote signal at all. Once failures repeat,
 * they must escalate to error level so they actually leave the machine.
 */

beforeEach(() => {
  _resetProviderHealth();
  vi.restoreAllMocks();
});

describe("providerHealth", () => {
  it("stays quiet while failures are still incidental", () => {
    const spy = vi.spyOn(logger, "error").mockImplementation(() => {});

    for (let i = 0; i < ESCALATE_AFTER - 1; i++) {
      recordFailure("yahoo", "fetchQuote", "Unexpected redirect");
    }

    expect(spy).not.toHaveBeenCalled();
  });

  it("escalates to error level once failures repeat", () => {
    const spy = vi.spyOn(logger, "error").mockImplementation(() => {});

    for (let i = 0; i < ESCALATE_AFTER; i++) {
      recordFailure("yahoo", "fetchQuote", "Unexpected redirect");
    }

    expect(spy).toHaveBeenCalledOnce();
    const [component, message] = spy.mock.calls[0];
    expect(component).toBe("providerHealth");
    expect(message).toContain("yahoo");
    expect(message).toContain("fetchQuote");
    expect(message).toContain("Unexpected redirect");
  });

  it("does not re-escalate on every subsequent failure", () => {
    const spy = vi.spyOn(logger, "error").mockImplementation(() => {});

    for (let i = 0; i < ESCALATE_AFTER + 5; i++) {
      recordFailure("yahoo", "fetchQuote", "Unexpected redirect");
    }

    expect(spy).toHaveBeenCalledOnce();
  });

  it("counts consecutive failures per provider and operation", () => {
    vi.spyOn(logger, "error").mockImplementation(() => {});
    recordFailure("yahoo", "fetchQuote", "boom");
    recordFailure("yahoo", "fetchQuote", "boom");
    recordFailure("frankfurter", "fetchRate", "404");

    expect(getProviderFailures()).toEqual({
      "yahoo.fetchQuote": 2,
      "frankfurter.fetchRate": 1,
    });
  });

  it("clears the counter on a success, so a later blip escalates afresh", () => {
    const spy = vi.spyOn(logger, "error").mockImplementation(() => {});

    for (let i = 0; i < ESCALATE_AFTER; i++) recordFailure("yahoo", "fetchQuote", "boom");
    expect(spy).toHaveBeenCalledOnce();

    recordSuccess("yahoo", "fetchQuote");
    expect(getProviderFailures()).toEqual({});

    for (let i = 0; i < ESCALATE_AFTER; i++) recordFailure("yahoo", "fetchQuote", "boom");
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("keeps operations independent — a healthy chart() does not mask a broken quote()", () => {
    vi.spyOn(logger, "error").mockImplementation(() => {});
    recordFailure("yahoo", "fetchQuote", "boom");
    recordSuccess("yahoo", "fetchHistorical");

    expect(getProviderFailures()).toEqual({ "yahoo.fetchQuote": 1 });
  });
});
