import { Injectable, inject, signal } from '@angular/core';
import { EMPTY, timer } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { ApiService } from './api.service';

export const NEWS_POLL_MS = 120_000;

/**
 * Teller van nieuwe artikels voor de navbar. De poll houdt ook de achtergrondophaling op de
 * backend gaande: /news/unread start een nieuwe ronde als de vorige te oud is.
 */
@Injectable({ providedIn: 'root' })
export class NewsBadgeService {
  private api = inject(ApiService);

  readonly unread = signal(0);

  constructor() {
    timer(0, NEWS_POLL_MS)
      .pipe(
        // Fout binnen de switchMap opvangen: een error die tot hier doorsijpelt beëindigt de
        // hele stream, en dan pollt de badge nooit meer.
        switchMap(() => this.api.getNewsUnread().pipe(catchError(() => EMPTY))),
      )
      .subscribe(r => this.unread.set(r.count));
  }

  /** Na een bezoek aan de Nieuws-tab: alles is gezien. */
  clear(): void {
    this.unread.set(0);
  }
}
