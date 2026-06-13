/**
 * Provider registry — single place where the app picks which implementations to use.
 *
 * To swap a provider, change the export below. Future work: read from env / settings.
 */
import { frankfurterProvider } from './frankfurterFx';
import { yahooFxProvider } from './yahooFx';
import { yahooPriceProvider } from './yahooPrice';
import { makeCompositeFx } from './compositeFx';
import type { FxProvider, PriceProvider } from './types';

/**
 * Default FX provider — Frankfurter (ECB) first, Yahoo as a fallback for pairs
 * ECB doesn't publish (e.g. TWD). Frankfurter has no rate limits and no key;
 * Yahoo is only hit when Frankfurter returns no data.
 */
export const fxProvider: FxProvider = makeCompositeFx(frankfurterProvider, yahooFxProvider);

/** Default stock-price provider. */
export const priceProvider: PriceProvider = yahooPriceProvider;

// Named exports if a service ever needs to bypass the default.
export { frankfurterProvider, yahooFxProvider, yahooPriceProvider };
export type * from './types';
