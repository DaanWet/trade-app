/**
 * Provider registry — single place where the app picks which implementations to use.
 *
 * To swap a provider, change the export below. Future work: read from env / settings.
 */
import { frankfurterProvider } from './frankfurterFx';
import { yahooFxProvider } from './yahooFx';
import { yahooPriceProvider } from './yahooPrice';
import type { FxProvider, PriceProvider } from './types';

/** Default FX provider — Frankfurter (ECB), no rate limits, no key. */
export const fxProvider: FxProvider = frankfurterProvider;

/** Default stock-price provider. */
export const priceProvider: PriceProvider = yahooPriceProvider;

// Named exports if a service ever needs to bypass the default.
export { frankfurterProvider, yahooFxProvider, yahooPriceProvider };
export type * from './types';
