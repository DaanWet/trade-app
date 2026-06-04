import { Injectable, computed, signal } from '@angular/core';

export type ProviderId = 'yahoo' | 'frankfurter';

/**
 * Safety-net ceiling matching the backend's MAX_AGE_MS (2 × the 5-min price-cache TTL).
 * Used only as a local, network-free fallback: if the user goes idle after a limit, the
 * banner still clears once this elapses without a fresh response confirming the limit.
 */
const MAX_AGE_MS = 10 * 60 * 1000;
/** How often the idle fallback re-checks the age. Coarse — it's only a backstop. */
const SWEEP_MS = 30 * 1000;

/**
 * App-wide market-data status, fed by the rate-limit HTTP interceptor (which reads the
 * `X-Rate-Limited` response header). A single <app-rate-limit-banner> host renders it.
 *
 * No polling: every API response the app already makes carries the current status, so the
 * interceptor calls report() on each one. report([]) clears immediately (the backend only
 * reports a limit until the next live call succeeds). The local timer only covers the
 * idle-after-recovery case and never touches the network.
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  /** Providers currently rate-limited, per the latest API response. */
  readonly rateLimited = signal<ProviderId[]>([]);
  /** Providers the user dismissed; auto-cleared once a provider drops out of the limited set. */
  private readonly dismissed = signal<Set<ProviderId>>(new Set());

  /** Limited providers the user hasn't dismissed — what the banner shows. */
  readonly visibleLimited = computed(() =>
    this.rateLimited().filter(p => !this.dismissed().has(p)),
  );

  private lastSeenAt = 0;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  /** Called by the interceptor with the providers from the `X-Rate-Limited` header. */
  report(limited: ProviderId[]): void {
    this.rateLimited.set(limited);
    // Un-dismiss anything that recovered, so a fresh limit later shows again.
    this.dismissed.update(d => new Set([...d].filter(p => limited.includes(p))));

    if (limited.length) {
      this.lastSeenAt = Date.now();
      this.startSweep();
    } else {
      this.stopSweep();
    }
  }

  /** Hide the banner for a provider until it recovers and is limited again. */
  dismiss(provider: ProviderId): void {
    this.dismissed.update(d => new Set(d).add(provider));
  }

  private startSweep(): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => {
      if (Date.now() - this.lastSeenAt >= MAX_AGE_MS) {
        this.rateLimited.set([]);
        this.stopSweep();
      }
    }, SWEEP_MS);
  }

  private stopSweep(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }
}
