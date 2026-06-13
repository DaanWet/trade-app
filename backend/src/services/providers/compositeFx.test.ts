import { describe, expect, it, vi } from "vitest";
import { makeCompositeFx } from "./compositeFx";
import type { FxProvider, FxRangePoint } from "./types";

function stub(name: string, rate: number | null, range: FxRangePoint[]): FxProvider {
  return {
    name,
    fetchRate: vi.fn(async () => rate),
    fetchRange: vi.fn(async () => range),
  };
}

const POINTS: FxRangePoint[] = [{ date: "2026-01-02", rate: 0.03 }];

describe("makeCompositeFx", () => {
  it("names itself primary+fallback", () => {
    const c = makeCompositeFx(stub("frankfurter", 1, []), stub("yahoo", 1, []));
    expect(c.name).toBe("frankfurter+yahoo");
  });

  describe("fetchRate", () => {
    it("uses the primary rate and never calls the fallback when primary has data", async () => {
      const primary = stub("p", 0.9, []);
      const fallback = stub("f", 0.5, []);
      const c = makeCompositeFx(primary, fallback);

      await expect(c.fetchRate("USD", "EUR", "2026-01-02")).resolves.toBe(0.9);
      expect(fallback.fetchRate).not.toHaveBeenCalled();
    });

    it("falls back to the secondary rate when primary returns null (e.g. TWD)", async () => {
      const primary = stub("p", null, []);
      const fallback = stub("f", 0.03, []);
      const c = makeCompositeFx(primary, fallback);

      await expect(c.fetchRate("TWD", "EUR", "2026-01-02")).resolves.toBe(0.03);
      expect(fallback.fetchRate).toHaveBeenCalledWith("TWD", "EUR", "2026-01-02");
    });

    it("returns null when neither provider has a rate", async () => {
      const c = makeCompositeFx(stub("p", null, []), stub("f", null, []));
      await expect(c.fetchRate("XXX", "EUR", "2026-01-02")).resolves.toBeNull();
    });
  });

  describe("fetchRange", () => {
    const FROM = new Date("2026-01-01");
    const TO = new Date("2026-01-31");

    it("uses the primary range and never calls the fallback when primary has points", async () => {
      const primary = stub("p", null, POINTS);
      const fallback = stub("f", null, [{ date: "2026-01-02", rate: 9 }]);
      const c = makeCompositeFx(primary, fallback);

      await expect(c.fetchRange("USD", "EUR", FROM, TO)).resolves.toEqual(POINTS);
      expect(fallback.fetchRange).not.toHaveBeenCalled();
    });

    it("falls back to the secondary range when primary is empty", async () => {
      const fallback = stub("f", null, POINTS);
      const c = makeCompositeFx(stub("p", null, []), fallback);
      await expect(c.fetchRange("TWD", "EUR", FROM, TO)).resolves.toEqual(POINTS);
      expect(fallback.fetchRange).toHaveBeenCalledWith("TWD", "EUR", FROM, TO);
    });

    it("returns an empty array when neither provider has points", async () => {
      const c = makeCompositeFx(stub("p", null, []), stub("f", null, []));
      await expect(c.fetchRange("XXX", "EUR", FROM, TO)).resolves.toEqual([]);
    });
  });
});
