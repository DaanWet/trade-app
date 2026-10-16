import { Component, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, switchMap } from 'rxjs/operators';
import { ApiService } from '../../services/api.service';
import type { TickerSearchResult } from '../../models';

/**
 * Tekstveld met Yahoo-autocomplete voor een ticker. Geeft het gekozen symbool door via
 * `picked`: een keuze uit de lijst, of het getypte symbool na Enter.
 * (De trade-form heeft deze logica nog ingebouwd; bewust niet omgezet, zie spec #11.)
 */
@Component({
  selector: 'app-ticker-search',
  standalone: true,
  template: `
    <div class="position-relative">
      <input
        type="text"
        class="form-control"
        [placeholder]="placeholder()"
        [value]="term()"
        (input)="onInput($any($event.target).value)"
        (focus)="showResults.set(true)"
        (blur)="hideResultsSoon()"
        (keydown.enter)="submitTyped($event)"
        autocomplete="off"
      />
      @if (showResults() && results().length > 0) {
        <ul class="dropdown-menu show w-100 mt-1" style="max-height: 240px; overflow-y: auto;">
          @for (r of results(); track r.symbol) {
            <li>
              <button type="button" class="dropdown-item" (mousedown)="pick(r.symbol)">
                <span class="fw-bold">{{ r.symbol }}</span>
                <span class="text-muted small ms-2">{{ r.name }}</span>
                <span class="text-muted small ms-2">{{ r.exchange }}</span>
              </button>
            </li>
          }
        </ul>
      }
    </div>
  `,
})
export class TickerSearchComponent {
  private api = inject(ApiService);
  private term$ = new Subject<string>();

  readonly placeholder = input('bv. AAPL');
  readonly picked = output<string>();

  term = signal('');
  results = signal<TickerSearchResult[]>([]);
  showResults = signal(false);

  constructor() {
    this.term$
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        // Fout binnen de switchMap opvangen, anders stopt de autocomplete na één fout.
        switchMap(t => this.api.searchTicker(t).pipe(catchError(() => of([] as TickerSearchResult[])))),
        takeUntilDestroyed(),
      )
      .subscribe(r => this.results.set(r));
  }

  onInput(value: string): void {
    this.term.set(value);
    if (value.trim()) {
      this.term$.next(value.trim());
      this.showResults.set(true);
    } else {
      this.results.set([]);
    }
  }

  hideResultsSoon(): void {
    setTimeout(() => this.showResults.set(false), 200);
  }

  pick(symbol: string): void {
    this.term.set('');
    this.results.set([]);
    this.showResults.set(false);
    this.picked.emit(symbol.toUpperCase());
  }

  submitTyped(event: Event): void {
    event.preventDefault();
    const symbol = this.term().trim();
    if (symbol) this.pick(symbol);
  }
}
