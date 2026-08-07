/**
 * Signalen die zichzelf onthouden in localStorage — voor UI-voorkeuren die geen
 * serverkant nodig hebben (welk tijdsbereik de grafiek toont, € of %).
 *
 * Bewust NIET de `settings`-tabel: die is voor gegevens die de berekeningen sturen
 * (weergavemunt) en gaat over de API. Dit zijn puur weergavekeuzes van deze browser.
 *
 * Opslag is best-effort: een omgeving die localStorage weigert (privémodus, uitgezette
 * opslag) verliest alleen het onthouden, nooit de werking.
 */
import { effect, signal, type WritableSignal } from '@angular/core';

const PREFIX = 'trade-app:';

function read(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(PREFIX + key, value);
  } catch {
    /* opslag geweigerd of vol — de app draait gewoon door */
  }
}

/**
 * Een string-signaal dat elke wijziging wegschrijft en bij het aanmaken zijn vorige
 * waarde terugleest.
 *
 * `allowed` is de vangrail: zonder die controle zou een verouderde of geknoeide waarde
 * uit opslag de UI in een toestand zetten die de code niet kent (een knoppenbalk zonder
 * actieve knop, een grafiek zonder bereik). Onbekende waarden vallen terug op `fallback`.
 * Laat `allowed` weg voor vrije tekst zoals een datum.
 *
 * Moet aangeroepen worden vanuit een injectiecontext (een veld van een component), want
 * het wegschrijven gebeurt met een `effect`.
 */
export function persistedString<T extends string>(
  key: string,
  fallback: T,
  allowed?: readonly T[],
): WritableSignal<T> {
  const stored = read(key);
  const valid = stored !== null && (!allowed || allowed.includes(stored as T));
  const state = signal<T>(valid ? (stored as T) : fallback);
  effect(() => write(key, state()));
  return state;
}
