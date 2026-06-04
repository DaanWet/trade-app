import { Component, OnInit, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import type { Trade, TradeInput, TradeSide, TickerSearchResult } from '../../models';
import { Subject, catchError, debounceTime, distinctUntilChanged, finalize, of, switchMap } from 'rxjs';
import { NumberPipe, DatePipe, SharesPipe } from '../number-format/format.pipes';
import { DecimalInputComponent } from '../decimal-input/decimal-input.component';
import { COMMON_CURRENCIES, formatShares } from '../../utils/format';
import { ConfirmService } from '../confirm/confirm.service';

/**
 * Strict YYYY-MM-DD validation. Rejects partial input ('2025-1'), nonsensical
 * dates ('2025-02-30') and out-of-range years (browsers happily accept 0001).
 */
function isValidIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s);
  if (isNaN(d.getTime())) return false;
  if (d.toISOString().slice(0, 10) !== s) return false;
  const year = d.getUTCFullYear();
  return year >= 1970 && year <= 2100;
}

@Component({
  selector: 'app-trade-form',
  standalone: true,
  imports: [FormsModule, NumberPipe, DatePipe, SharesPipe, DecimalInputComponent],
  templateUrl: './trade-form.component.html',
})
export class TradeFormComponent implements OnInit {
  private api = inject(ApiService);
  private confirm = inject(ConfirmService);

  initial = input<Trade | null>(null);
  saved = output<Trade>();
  cancelled = output<void>();

  form = signal<TradeInput>({
    ticker: '',
    trade_date: new Date().toISOString().slice(0, 10),
    side: 'BUY',
    shares: 0,
    price: 0,
    currency: 'EUR',
    fees: 0,
    notes: '',
  });
  saving = signal(false);
  error = signal<string | null>(null);
  searchResults = signal<TickerSearchResult[]>([]);
  showResults = signal(false);

  /** Set to true the moment the user manually edits the price input. After
   *  that, ticker/date changes no longer overwrite their value. Reset on ticker change. */
  private priceTouched = signal(false);

  /** Last price we auto-fetched, surfaced to the UI as "Suggested: $X.XX (date)". */
  suggestedPrice = signal<{ price: number; currency: string | null; date: string } | null>(null);
  fetchingPrice = signal(false);

  /** Shares held for the current ticker as of the trade date (null = unknown / not a SELL).
   *  A helpful hint; the backend remains the authority on the hard block. */
  held = signal<number | null>(null);

  readonly sides: TradeSide[] = ['BUY', 'SELL'];
  readonly currencies = COMMON_CURRENCIES;

  /** True when a SELL would close more shares than are held (drives the inline warning). */
  sellExceedsHeld = computed(() => {
    const f = this.form();
    const h = this.held();
    return f.side === 'SELL' && h != null && f.shares > h;
  });

  private searchTerm$ = new Subject<string>();
  private priceLookup$ = new Subject<{ ticker: string; date: string }>();
  private holdingsLookup$ = new Subject<{ ticker: string; date: string }>();

  /** Lookup key for held shares: only for a SELL with a plausible ticker + valid date. */
  private holdingsLookupKey = computed(() => {
    const f = this.form();
    if (f.side !== 'SELL') return null;
    const ticker = f.ticker.trim();
    if (ticker.length < 1) return null;
    if (!isValidIsoDate(f.trade_date)) return null;
    return `${ticker}|${f.trade_date}`;
  });

  /** Computed lookup key: only emits a non-null value when ticker is plausibly
   *  complete AND the date passes strict ISO validation. */
  private priceLookupKey = computed(() => {
    const f = this.form();
    const ticker = f.ticker.trim();
    if (ticker.length < 2) return null;
    if (!isValidIsoDate(f.trade_date)) return null;
    return `${ticker}|${f.trade_date}`;
  });

  constructor() {
    // Push (ticker, date) changes through a debounced subject so we don't hit
    // the API on every keystroke.
    effect(() => {
      const key = this.priceLookupKey();
      if (!key) {
        this.suggestedPrice.set(null);
        return;
      }
      const [ticker, date] = key.split('|');
      this.priceLookup$.next({ ticker, date });
    });

    // Fetch how many shares are sellable whenever a SELL's ticker/date is valid.
    effect(() => {
      const key = this.holdingsLookupKey();
      if (!key) {
        this.held.set(null);
        return;
      }
      const [ticker, date] = key.split('|');
      this.holdingsLookup$.next({ ticker, date });
    });
  }

  ngOnInit(): void {
    const init = this.initial();
    if (init) {
      // Editing an existing trade: preserve user's original values, treat price as touched.
      this.form.set({
        ticker: init.ticker,
        trade_date: init.trade_date,
        side: init.side,
        shares: init.shares,
        price: init.price,
        currency: init.currency,
        fees: init.fees,
        notes: init.notes ?? '',
      });
      this.priceTouched.set(true);
    }

    this.searchTerm$.pipe(
      debounceTime(250),
      // Catch INSIDE switchMap — otherwise one HTTP error kills the whole subscription and
      // all future searches silently stop firing (same reason as priceLookup$ below).
      switchMap(term => this.api.searchTicker(term).pipe(catchError(() => of([] as TickerSearchResult[])))),
    ).subscribe(results => this.searchResults.set(results));

    this.priceLookup$.pipe(
      distinctUntilChanged((a, b) => a.ticker === b.ticker && a.date === b.date),
      debounceTime(400),
      switchMap(({ ticker, date }) => {
        this.fetchingPrice.set(true);
        // Errors must be caught INSIDE switchMap. If they propagate to the outer
        // observable, the entire subscription dies and future lookups silently
        // stop firing.
        return this.api.getPriceAt(ticker, date).pipe(
          catchError(() => of(null)),
        );
      }),
    ).subscribe(result => {
      this.fetchingPrice.set(false);
      if (!result) {
        this.suggestedPrice.set(null);
        return;
      }
      this.suggestedPrice.set(result);
      if (result.currency) this.patch('currency', result.currency);
      if (!this.priceTouched()) this.patch('price', result.price);
    });

    this.holdingsLookup$.pipe(
      distinctUntilChanged((a, b) => a.ticker === b.ticker && a.date === b.date),
      debounceTime(300),
      // Catch INSIDE switchMap so one failed lookup doesn't kill the subscription.
      // Editing a trade excludes itself so the baseline ignores this very SELL.
      switchMap(({ ticker, date }) =>
        this.api.getHoldings(ticker, date, this.initial()?.id).pipe(catchError(() => of(null))),
      ),
    ).subscribe(result => this.held.set(result ? result.shares_held : null));
  }

  patch<K extends keyof TradeInput>(key: K, value: TradeInput[K]): void {
    this.form.update(f => ({ ...f, [key]: value }));
  }

  /** Called from the price input — marks the field as user-edited so ticker/date
   *  changes no longer overwrite it. */
  onPriceInput(value: number): void {
    this.priceTouched.set(true);
    this.patch('price', value);
  }

  onTickerInput(value: string): void {
    const next = value.toUpperCase();
    if (next !== this.form().ticker) {
      // New ticker → previous "suggested" price no longer applies; allow re-fill.
      this.priceTouched.set(false);
    }
    this.patch('ticker', next);
    if (value.trim().length >= 1) {
      this.searchTerm$.next(value);
      this.showResults.set(true);
    } else {
      this.searchResults.set([]);
    }
  }

  hideResultsSoon(): void {
    setTimeout(() => this.showResults.set(false), 200);
  }

  pickResult(r: TickerSearchResult): void {
    this.priceTouched.set(false);
    this.patch('ticker', r.symbol);
    this.showResults.set(false);
    // The effect() will trigger lookupPrice() on its own.
  }

  /** Apply the most recently suggested price to the form (used by the "use" button). */
  useSuggestedPrice(): void {
    const s = this.suggestedPrice();
    if (!s) return;
    this.patch('price', s.price);
    if (s.currency) this.patch('currency', s.currency);
    this.priceTouched.set(false);
  }

  submit(): void {
    this.error.set(null);
    const f = this.form();
    if (!f.ticker || f.shares <= 0 || f.price < 0) {
      this.error.set('Vul ticker, aantal aandelen en prijs in.');
      return;
    }
    // Client-side guard so the user rarely hits the backend's hard 400. When `held` is
    // null (lookup pending/failed) sellExceedsHeld() is false and the backend decides.
    if (this.sellExceedsHeld()) {
      this.error.set(`Je bezit slechts ${formatShares(this.held()!)} aandelen van ${f.ticker}.`);
      return;
    }
    this.saving.set(true);
    const init = this.initial();
    this.confirm
      .confirmOnCashOverdraw(
        c => (init ? this.api.updateTrade(init.id, f, c) : this.api.createTrade(f, c)),
        { confirmText: 'Toch toevoegen' },
      )
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: trade => this.saved.emit(trade),
        error: err => this.error.set(err?.error?.error ?? 'Opslaan mislukt'),
      });
  }
}
