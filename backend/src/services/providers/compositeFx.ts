import type { FxProvider } from './types';

/**
 * Compose two FxProviders into a fallback chain: try `primary`, and only when it
 * has no data (fetchRate → null, fetchRange → empty) defer to `fallback`.
 *
 * This lets Frankfurter (ECB) serve every currency it publishes while a secondary
 * provider (Yahoo) fills the gaps ECB doesn't cover — most notably TWD, which has
 * no ECB reference rate. The concrete providers already swallow their own transport
 * errors and return null/empty, so a clean "no data" result is the only fallback
 * trigger and nothing here needs a try/catch.
 */
export function makeCompositeFx(primary: FxProvider, fallback: FxProvider): FxProvider {
  return {
    name: `${primary.name}+${fallback.name}`,

    async fetchRate(base, quote, date) {
      const rate = await primary.fetchRate(base, quote, date);
      return rate != null ? rate : fallback.fetchRate(base, quote, date);
    },

    async fetchRange(base, quote, from, to) {
      const points = await primary.fetchRange(base, quote, from, to);
      return points.length > 0 ? points : fallback.fetchRange(base, quote, from, to);
    },
  };
}
