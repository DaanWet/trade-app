/**
 * Formatting helpers shared between components.
 * Locale: nl-BE for the Belgian user (decimal comma, EUR symbol).
 */

export const LOCALE = 'nl-BE';

export function formatMoney(value: number | null | undefined, currency: string, fractionDigits = 2): string {
  if (value == null || isNaN(value)) return '—';
  return new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

export function formatNumber(value: number | null | undefined, fractionDigits = 2): string {
  if (value == null || isNaN(value)) return '—';
  return new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

export function formatPercent(value: number | null | undefined, fractionDigits = 2): string {
  if (value == null || isNaN(value)) return '—';
  return new Intl.NumberFormat(LOCALE, {
    style: 'percent',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value / 100);
}

export function formatShares(value: number | null | undefined): string {
  if (value == null) return '—';
  // Up to 6 decimals, trim trailing zeros
  const fixed = value.toFixed(6).replace(/\.?0+$/, '');
  return new Intl.NumberFormat(LOCALE).format(parseFloat(fixed));
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(LOCALE, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
}

/** Datum + tijdstip, voor momenten waarop het uur ertoe doet (bv. hoe oud een koers is). */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(LOCALE, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

const RELATIVE = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' });

/**
 * Hoe lang geleden: "zonet", "5 minuten geleden", "2 uur geleden", "gisteren".
 * Vanaf 24 uur telt het kalenderdagen; na 7 dagen wordt het een gewone datum.
 */
export function formatRelativeTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const diff = now.getTime() - d.getTime();
  if (diff < 60_000) return 'zonet';
  if (diff < 3_600_000) return RELATIVE.format(-Math.floor(diff / 60_000), 'minute');
  if (diff < 86_400_000) return RELATIVE.format(-Math.floor(diff / 3_600_000), 'hour');
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (days > 7) return formatDate(iso);
  return RELATIVE.format(-days, 'day');
}

/** Parse een door de gebruiker getypt decimaal getal; accepteert zowel ',' als
 *  '.' als decimaalteken. Geeft 0 terug bij leeg/ongeldig zodat het formulier
 *  numeriek blijft. */
export function parseDecimalInput(raw: string | null | undefined): number {
  if (raw == null) return 0;
  const normalized = raw.trim().replace(',', '.');
  if (normalized === '') return 0;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

export function pnlClass(value: number | null | undefined): string {
  if (value == null || value === 0) return '';
  return value > 0 ? 'text-success' : 'text-danger';
}

/** Currencies offered in the trade-/cash-form selectors and the settings display-currency
 *  picker. The full ECB reference set (all convertible via Frankfurter) plus TWD (convertible
 *  via the Yahoo FX fallback). EUR/USD pinned first, the rest alphabetical. */
export const COMMON_CURRENCIES = [
  'EUR',
  'USD',
  'AUD',
  'BRL',
  'CAD',
  'CHF',
  'CNY',
  'CZK',
  'DKK',
  'GBP',
  'HKD',
  'HUF',
  'IDR',
  'ILS',
  'INR',
  'ISK',
  'JPY',
  'KRW',
  'MXN',
  'MYR',
  'NOK',
  'NZD',
  'PHP',
  'PLN',
  'RON',
  'SEK',
  'SGD',
  'THB',
  'TRY',
  'TWD',
  'ZAR',
];
