import { describe, expect, it } from "vitest";
import { errorMessage, fetchErrorMessage } from "./errors";

describe("fetchErrorMessage", () => {
  it("appends the network error code undici puts in cause", () => {
    const err = new TypeError("fetch failed", { cause: { code: "UND_ERR_HEADERS_OVERFLOW" } });
    expect(fetchErrorMessage(err)).toBe("fetch failed (UND_ERR_HEADERS_OVERFLOW)");
  });

  it("never uses the cause's message: it can contain a url", () => {
    const err = new TypeError("fetch failed", {
      cause: Object.assign(new Error("getaddrinfo ENOTFOUND geheim-keyword.example"), { code: "ENOTFOUND" }),
    });
    expect(fetchErrorMessage(err)).toBe("fetch failed (ENOTFOUND)");
    expect(fetchErrorMessage(new TypeError("fetch failed", { cause: new Error("geheim") }))).toBe("fetch failed");
  });

  it("falls back to errorMessage without a string code", () => {
    expect(fetchErrorMessage(new Error("boom"))).toBe("boom");
    expect(fetchErrorMessage(new Error("boom", { cause: { code: 42 } }))).toBe("boom");
    expect(fetchErrorMessage("plain")).toBe(errorMessage("plain"));
    expect(fetchErrorMessage(undefined)).toBe("Unknown error");
  });
});
