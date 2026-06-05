import { afterAll, beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// Point the logger at a throwaway dir. The logger resolves LOG_DIR fresh on each write and
// does no logging at import time, so setting it here (after the hoisted import) is safe.
const TMP = path.join(os.tmpdir(), `tradeapp-logtest-${process.pid}`);
process.env.LOG_DIR = TMP;

import {
  logger,
  getRecentEvents,
  getLogFilePath,
  setRemoteSink,
  _resetLogBuffer,
  type RecentEvent,
} from "./logger";

beforeEach(() => {
  _resetLogBuffer();
  setRemoteSink(null);
});

afterAll(() => {
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("logger", () => {
  it("writes an error (with its stack) to the log file on disk", () => {
    logger.error("test", "boom", new Error("kaboom"));
    const contents = fs.readFileSync(getLogFilePath(), "utf8");
    expect(contents).toContain("[test] boom");
    expect(contents).toContain("kaboom"); // stack of the Error
  });

  it("records each event in the ring buffer (newest last)", () => {
    logger.warn("test", "heads up");
    const events = getRecentEvents();
    expect(events.at(-1)).toMatchObject({ level: "warn", component: "test", message: "heads up" });
  });

  it("invokes the injected remote sink with the event", () => {
    const calls: RecentEvent[] = [];
    setRemoteSink((ev) => calls.push(ev));
    logger.error("test", "remote", new Error("x"));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ level: "error", component: "test", message: "remote" });
    expect(calls[0].errorName).toBe("Error");
  });

  it("never throws when no sink is set (no-op default)", () => {
    expect(() => logger.info("test", "no sink")).not.toThrow();
  });
});
