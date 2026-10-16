import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '../../../environments/environment';
import type { NewsArticle, NewsResponse } from '../../models';
import { NewsBadgeService } from '../../services/news-badge.service';
import { NewsComponent } from './news.component';

const base = environment.apiBaseUrl;

function article(id: string, isNew: boolean, extra: Partial<NewsArticle> = {}): NewsArticle {
  return {
    id,
    title: `Titel ${id}`,
    publisher: 'Bron',
    url: `https://example.com/${id}`,
    published_at: '2026-10-15T08:00:00.000Z',
    source: 'yahoo',
    image_url: null,
    summary: null,
    topics: [{ kind: 'TICKER', value: 'NVDA' }],
    is_new: isNew,
    ...extra,
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
    localStorage.removeItem('trade-app:news.view');
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

  function openWith(articles: NewsArticle[]) {
    const fixture = open();
    http.expectOne(`${base}/news`).flush(response(articles, '2026-10-15T12:00:00.000Z'));
    flushSeen('2026-10-15T12:00:00.000Z');
    fixture.detectChanges();
    return fixture;
  }

  const WITH_PREVIEW = { image_url: 'https://img.example/a.jpg', summary: 'Korte inleiding' };

  it('toont standaard de uitgebreide weergave met afbeelding en inleiding', () => {
    const el: HTMLElement = openWith([article('a', false, WITH_PREVIEW)]).nativeElement;

    const img = el.querySelector<HTMLImageElement>('[data-test="thumb"]')!;
    expect(img.getAttribute('src')).toBe('https://img.example/a.jpg');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(el.querySelector('[data-test="summary"]')?.textContent?.trim()).toBe('Korte inleiding');
  });

  it('verbergt afbeelding en inleiding in de compacte weergave en onthoudt die keuze', () => {
    const fixture = openWith([article('a', false, WITH_PREVIEW)]);
    fixture.nativeElement.querySelector('[data-test="view-compact"]').click();
    fixture.detectChanges();
    TestBed.tick();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-test="thumb"]')).toBeNull();
    expect(el.querySelector('[data-test="thumb-placeholder"]')).toBeNull();
    expect(el.querySelector('[data-test="summary"]')).toBeNull();
    expect(localStorage.getItem('trade-app:news.view')).toBe('compact');

    const again: HTMLElement = openWith([article('a', false, WITH_PREVIEW)]).nativeElement;
    expect(again.querySelector('[data-test="thumb"]')).toBeNull();
  });

  it('toont een placeholder zonder afbeelding of als die niet laadt', () => {
    const fixture = openWith([article('a', false), article('b', false, WITH_PREVIEW)]);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelectorAll('[data-test="thumb-placeholder"]').length).toBe(1);

    el.querySelector('[data-test="thumb"]')!.dispatchEvent(new Event('error'));
    fixture.detectChanges();

    expect(el.querySelectorAll('[data-test="thumb-placeholder"]').length).toBe(2);
    expect(el.querySelector('[data-test="thumb"]')).toBeNull();
  });

  it('zet het NIEUW-label in de uitgebreide weergave inline vóór de titel', () => {
    const el: HTMLElement = openWith([article('a', true)]).nativeElement;
    expect(el.querySelector('[data-test="new-label"]')!.closest('.news-body')).not.toBeNull();
  });

  it('toont het NIEUW-label in de compacte weergave als aparte badge naast de titel', () => {
    const fixture = openWith([article('a', true)]);
    fixture.nativeElement.querySelector('[data-test="view-compact"]').click();
    fixture.detectChanges();
    TestBed.tick();

    const label = (fixture.nativeElement as HTMLElement).querySelector('[data-test="new-label"]');
    expect(label).not.toBeNull();
    expect(label!.closest('.news-body')).toBeNull();
  });

  it('houdt artikeltekst uit Sentry: de inleiding heeft een vaste elementnaam en de lijst is geblokkeerd', () => {
    const el: HTMLElement = openWith([article('a', false, WITH_PREVIEW)]).nativeElement;

    // htmlTreeAsString (click-breadcrumbs, INP/LCP-spans) gebruikt data-sentry-element i.p.v. [title].
    expect(el.querySelector('[data-test="summary"]')!.getAttribute('data-sentry-element')).toBe('news-summary');
    // Session Replay omzeilt beforeSend: het blok wordt als placeholder opgenomen (geen href's).
    expect(el.querySelector('ul.list-group')!.hasAttribute('data-sentry-block')).toBeTrue();
  });

  it('laat lange woorden afbreken in de uitgebreide weergave', () => {
    const el: HTMLElement = openWith([article('a', false, { summary: 'x'.repeat(500) })]).nativeElement;
    const body = el.querySelector<HTMLElement>('.news-body')!;
    expect(getComputedStyle(body).overflowWrap).toBe('anywhere');
    expect(getComputedStyle(body).minWidth).toBe('0px');
  });
});
