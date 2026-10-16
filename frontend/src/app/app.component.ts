import { Component, inject } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { ConfirmDialogComponent } from './shared/confirm/confirm-dialog.component';
import { RateLimitBannerComponent } from './shared/notification/rate-limit-banner.component';
import { NewsBadgeService } from './services/news-badge.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ConfirmDialogComponent, RateLimitBannerComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  /** Root-injectie start de poll, op elke pagina. */
  protected newsBadge = inject(NewsBadgeService);
}
