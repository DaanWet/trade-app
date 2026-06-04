import { HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { tap } from 'rxjs';
import { NotificationService, ProviderId } from './notification.service';

const KNOWN_PROVIDERS: readonly string[] = ['yahoo', 'frankfurter'];

/**
 * Mirrors the backend `X-Rate-Limited` response header into NotificationService on every
 * successful API response. A missing/empty header reports `[]` (no active limit) — that's
 * how the banner clears once the next live provider call succeeds. Error responses are left
 * untouched so they propagate unchanged to the components.
 */
export const rateLimitInterceptor: HttpInterceptorFn = (req, next) => {
  const notify = inject(NotificationService);
  return next(req).pipe(
    tap(event => {
      if (!(event instanceof HttpResponse)) return;
      const limited = (event.headers.get('X-Rate-Limited') ?? '')
        .split(',')
        .map(s => s.trim())
        .filter((s): s is ProviderId => KNOWN_PROVIDERS.includes(s));
      notify.report(limited);
    }),
  );
};
