import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '../../../environments/environment';
import type { NewsArticle, NewsResponse } from '../../models';
import { NewsBadgeService } from '../../services/news-badge.service';
import { NewsComponent } from './news.component';

const base = environment.apiBaseUrl;

function article(id: string, isNew: boolean): NewsArticle {
  return {
    id,
    title: `Titel ${id}`,
    publisher: 'Bron',
    url: `https://example.com/${id}`,
    published_at: '2026-10-15T08:00:00.000Z',
    source: 'yahoo',
    topics: [{ kind: 'TICKER', value: 'NVDA' }],
    is_new: isNew,
  };
}

function response(articles: NewsArticle[], asOf: string, refreshing = false): NewsResponse {
  return {
    articles,
    topics: [{ id: null, kind: 'TICKER', value: 'NVDA', origin: 'POSITION' }],
    status: { last_refresh_at: asOf, refreshing, failed_topics: [] },
    as_of: asOf,
  };
}

describe('NewsComponent', () => {
  let http: HttpTestingController;
  let badge: { clear: jasmine.Spy };

  beforeEach(() => {
    badge = { clear: jasmine.createSpy('clear') };
    TestBed.configureTestingModule({
      imports: [NewsComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: NewsBadgeService, useValue: badge }],
    });
    http = TestBed.inject(HttpTestingController);
  });

  function open() {
    const fixture = TestBed.createComponent(NewsComponent);
    fixture.detectChanges();
    return fixture;
  }

  function flushSeen(expectedAsOf: string) {
    const seen = http.expectOne(`${base}/news/seen`);
    expect(seen.request.body).toEqual({ seen_at: expectedAsOf });
    seen.flush(null, { status: 204, statusText: 'No Content' });
  }

  it('markeert het geladen antwoord als gezien met de as_of van de server', () => {
    open();
    http.expectOne(`${base}/news`).flush(response([article('a', true)], '2026-10-15T12:00:00.000Z'));

    flushSeen('2026-10-15T12:00:00.000Z');
    expect(badge.clear).toHaveBeenCalled();
  });

  it('houdt NIEUW-labels van bij het openen vast na vernieuwen', () => {
    const fixture = open();
    http.expectOne(`${base}/news`).flush(response([article('a', true)], '2026-10-15T12:00:00.000Z'));
    flushSeen('2026-10-15T12:00:00.000Z');

    fixture.componentInstance.refresh();
    http
      .expectOne({ method: 'POST', url: `${base}/news/refresh` })
      .flush(response([article('b', true), article('a', false)], '2026-10-15T12:05:00.000Z'));
    flushSeen('2026-10-15T12:05:00.000Z');
    fixture.detectChanges();

    const labels = fixture.nativeElement.querySelectorAll('[data-test="new-label"]');
    expect(labels.length).toBe(2);
  });

  it('wacht een lopende achtergrondronde af in plaats van leeg te blijven', () => {
    open();
    http.expectOne(`${base}/news`).flush(response([], '2026-10-15T12:00:00.000Z', true));
    flushSeen('2026-10-15T12:00:00.000Z');

    http
      .expectOne({ method: 'POST', url: `${base}/news/refresh` })
      .flush(response([article('a', true)], '2026-10-15T12:00:30.000Z'));
    flushSeen('2026-10-15T12:00:30.000Z');
  });
});
