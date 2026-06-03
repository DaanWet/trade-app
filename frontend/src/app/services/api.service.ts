import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import type {
  Trade,
  TradeInput,
  PositionsResponse,
  RealizedLot,
  PortfolioPoint,
  TickerSearchResult,
  TickerQuote,
  TaxReport,
  CashResponse,
  CashTransaction,
  CashInput,
} from '../models';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  private base = environment.apiBaseUrl;

  // Trades
  listTrades(ticker?: string): Observable<Trade[]> {
    const url = ticker ? `${this.base}/trades?ticker=${encodeURIComponent(ticker)}` : `${this.base}/trades`;
    return this.http.get<Trade[]>(url);
  }
  createTrade(input: TradeInput, confirm = false): Observable<Trade> {
    return this.http.post<Trade>(`${this.base}/trades`, confirm ? { ...input, confirm } : input);
  }
  updateTrade(id: number, input: TradeInput, confirm = false): Observable<Trade> {
    return this.http.put<Trade>(`${this.base}/trades/${id}`, confirm ? { ...input, confirm } : input);
  }
  deleteTrade(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/trades/${id}`);
  }

  // Positions
  getPositions(): Observable<PositionsResponse> {
    return this.http.get<PositionsResponse>(`${this.base}/positions`);
  }
  getRealized(): Observable<RealizedLot[]> {
    return this.http.get<RealizedLot[]>(`${this.base}/positions/realized`);
  }
  getPortfolioHistory(): Observable<PortfolioPoint[]> {
    return this.http.get<PortfolioPoint[]>(`${this.base}/positions/history`);
  }

  // Prices
  searchTicker(query: string): Observable<TickerSearchResult[]> {
    return this.http.get<TickerSearchResult[]>(`${this.base}/prices/search?q=${encodeURIComponent(query)}`);
  }
  getQuote(symbol: string, force = false): Observable<TickerQuote> {
    const qs = force ? '?force=1' : '';
    return this.http.get<TickerQuote>(`${this.base}/prices/quote/${encodeURIComponent(symbol)}${qs}`);
  }
  getPriceAt(symbol: string, date: string): Observable<{ price: number; currency: string | null; date: string }> {
    return this.http.get<{ price: number; currency: string | null; date: string }>(
      `${this.base}/prices/at/${encodeURIComponent(symbol)}?date=${encodeURIComponent(date)}`,
    );
  }

  // Cash
  getCash(): Observable<CashResponse> {
    return this.http.get<CashResponse>(`${this.base}/cash`);
  }
  createCashTransaction(input: CashInput): Observable<CashTransaction> {
    return this.http.post<CashTransaction>(`${this.base}/cash`, input);
  }
  updateCashTransaction(id: number, input: CashInput): Observable<CashTransaction> {
    return this.http.put<CashTransaction>(`${this.base}/cash/${id}`, input);
  }
  deleteCashTransaction(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/cash/${id}`);
  }

  // Tax
  getTaxReport(): Observable<TaxReport> {
    return this.http.get<TaxReport>(`${this.base}/tax`);
  }

  // Settings
  getSettings(): Observable<Record<string, string>> {
    return this.http.get<Record<string, string>>(`${this.base}/settings`);
  }
  updateSettings(patch: Record<string, string>): Observable<Record<string, string>> {
    return this.http.put<Record<string, string>>(`${this.base}/settings`, patch);
  }
}
