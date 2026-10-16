import { TestBed, discardPeriodicTasks, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '../../environments/environment';
import { NEWS_POLL_MS, NewsBadgeService } from './news-badge.service';

describe('NewsBadgeService', () => {
  const url = `${environment.apiBaseUrl}/news/unread`;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
  });

  it('blijft pollen na een mislukte request', fakeAsync(() => {
    const badge = TestBed.inject(NewsBadgeService);
    tick(0);
    http.expectOne(url).flush({ error: 'boom' }, { status: 500, statusText: 'Server Error' });
    expect(badge.unread()).toBe(0);

    tick(NEWS_POLL_MS);
    http.expectOne(url).flush({ count: 3, refreshing: false });
    expect(badge.unread()).toBe(3);

    discardPeriodicTasks();
  }));

  it('clear zet de teller op 0', fakeAsync(() => {
    const badge = TestBed.inject(NewsBadgeService);
    tick(0);
    http.expectOne(url).flush({ count: 5, refreshing: false });

    badge.clear();

    expect(badge.unread()).toBe(0);
    discardPeriodicTasks();
  }));
});
