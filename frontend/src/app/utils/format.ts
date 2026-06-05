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

/** Currencies offered in the trade- and cash-form selectors. */
export const COMMON_CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'JPY', 'CAD', 'AUD'];
