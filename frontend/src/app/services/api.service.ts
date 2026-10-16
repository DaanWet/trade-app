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
  TaxLot,
  CashResponse,
  CashTransaction,
  CashInput,
  Holdings,
  NewsResponse,
  NewsTopic,
  NewsTopicRef,
  NewsUnread,
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
    return this.http.post<Trade>(`${this.base}/trades${confirm ? '?confirm=1' : ''}`, input);
  }
  updateTrade(id: number, input: TradeInput, confirm = false): Observable<Trade> {
    return this.http.put<Trade>(`${this.base}/trades/${id}${confirm ? '?confirm=1' : ''}`, input);
  }
  deleteTrade(id: number, confirm = false): Observable<void> {
    return this.http.delete<void>(`${this.base}/trades/${id}${confirm ? '?confirm=1' : ''}`);
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
  /** Open shares held for a ticker; used by the trade-form to validate SELLs.
   *  `date` caps the walk (inclusive); `excludeTradeId` ignores the trade being edited. */
  getHoldings(ticker: string, date?: string, excludeTradeId?: number): Observable<Holdings> {
    const qs =
      `?ticker=${encodeURIComponent(ticker)}` +
      (date ? `&date=${encodeURIComponent(date)}` : '') +
      (excludeTradeId != null ? `&excludeTradeId=${excludeTradeId}` : '');
    return this.http.get<Holdings>(`${this.base}/positions/holdings${qs}`);
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
  getTaxLots(): Observable<TaxLot[]> {
    return this.http.get<TaxLot[]>(`${this.base}/tax/lots`);
  }

  // Settings
  getSettings(): Observable<Record<string, string>> {
    return this.http.get<Record<string, string>>(`${this.base}/settings`);
  }
  updateSettings(patch: Record<string, string>): Observable<Record<string, string>> {
    return this.http.put<Record<string, string>>(`${this.base}/settings`, patch);
  }

  // Nieuws
  getNews(): Observable<NewsResponse> {
    return this.http.get<NewsResponse>(`${this.base}/news`);
  }
  getNewsUnread(): Observable<NewsUnread> {
    return this.http.get<NewsUnread>(`${this.base}/news/unread`);
  }
  markNewsSeen(seenAt: string): Observable<void> {
    return this.http.post<void>(`${this.base}/news/seen`, { seen_at: seenAt });
  }
  refreshNews(): Observable<NewsResponse> {
    return this.http.post<NewsResponse>(`${this.base}/news/refresh`, {});
  }
  addNewsTopic(topic: NewsTopicRef): Observable<{ topic: NewsTopic }> {
    return this.http.post<{ topic: NewsTopic }>(`${this.base}/news/topics`, topic);
  }
  deleteNewsTopic(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/news/topics/${id}`);
  }
}
