/**
 * Gedeelde sorteer-mechaniek voor tabellen (trades-lijst + dashboard-posities).
 * Client-side: kolomkoppen togglen een SortState, een `computed` past compareValues toe.
 * Locale nl-BE, in lijn met format.ts.
 */
import { signal } from '@angular/core';
import { LOCALE } from './format';

export type SortDir = 'asc' | 'desc';

/**
 * Null/NaN-veilige vergelijking. Lege waarden sorteren altijd onderaan (ongeacht
 * richting). Getallen numeriek; al het andere locale-aware als string.
 */
export function compareValues(a: unknown, b: unknown): number {
  const aNil = a == null || (typeof a === "number" && isNaN(a));
  const bNil = b == null || (typeof b === "number" && isNaN(b));
  if (aNil && bNil) return 0;
  if (aNil) return 1;
  if (bNil) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), LOCALE, { numeric: true, sensitivity: "base" });
}

/**
 * Houdt de actieve sorteerkolom + richting bij. Mag in een gewone klasse worden
 * aangemaakt (signal() vereist geen injection-context), dus bruikbaar in zowel
 * page- als shared components.
 */
export class SortState {
  readonly key;
  readonly dir;

  constructor(initialKey: string | null = null, initialDir: SortDir = "asc") {
    this.key = signal<string | null>(initialKey);
    this.dir = signal<SortDir>(initialDir);
  }

  /** Zelfde kolom → richting omklappen; andere kolom → nieuwe key, oplopend. */
  toggle(key: string): void {
    if (this.key() === key) {
      this.dir.update(d => (d === "asc" ? "desc" : "asc"));
    } else {
      this.key.set(key);
      this.dir.set("asc");
    }
  }

  /** Bootstrap-icon-class voor de kop van `key`. */
  icon(key: string): string {
    if (this.key() !== key) return "bi-arrow-down-up opacity-50";
    return this.dir() === "asc" ? "bi-caret-up-fill" : "bi-caret-down-fill";
  }
}
