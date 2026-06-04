import { Component, inject } from '@angular/core';
import { NotificationService, ProviderId } from './notification.service';

const PROVIDER_LABELS: Record<ProviderId, string> = {
  yahoo: 'koersen (Yahoo Finance)',
  frankfurter: 'wisselkoersen (ECB/Frankfurter)',
};

/**
 * Banner host for rate-limit warnings, fed by NotificationService (via the HTTP
 * interceptor). Mount once, in AppComponent. Pure Bootstrap 5 markup — no Bootstrap JS.
 */
@Component({
  selector: 'app-rate-limit-banner',
  standalone: true,
  template: `
    @for (provider of notify.visibleLimited(); track provider) {
      <div class="alert alert-warning alert-dismissible d-flex align-items-start mb-3" role="alert">
        <i class="bi bi-exclamation-triangle-fill me-2 mt-1"></i>
        <div>
          De externe gegevensbron voor {{ label(provider) }} heeft tijdelijk een aanvraaglimiet
          bereikt. Sommige gegevens kunnen verouderd zijn — we proberen het automatisch opnieuw.
        </div>
        <button type="button" class="btn-close" aria-label="Sluiten" (click)="notify.dismiss(provider)"></button>
      </div>
    }
  `,
})
export class RateLimitBannerComponent {
  protected notify = inject(NotificationService);

  protected label(provider: ProviderId): string {
    return PROVIDER_LABELS[provider] ?? provider;
  }
}
