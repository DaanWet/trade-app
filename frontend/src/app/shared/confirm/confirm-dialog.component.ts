import { Component, HostListener, inject } from '@angular/core';
import { ConfirmService } from './confirm.service';

/**
 * Single modal host for ConfirmService. Mount once (in AppComponent).
 * Pure Bootstrap 5 markup driven by a signal — no Bootstrap JS needed.
 */
@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  template: `
    @if (confirm.pending(); as p) {
      <div class="modal-backdrop fade show"></div>
      <div class="modal fade show d-block" tabindex="-1" (click)="onBackdrop($event)">
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">{{ p.title }}</h5>
              <button type="button" class="btn-close" aria-label="Sluiten" (click)="confirm.settle(false)"></button>
            </div>
            <div class="modal-body">
              <p class="mb-0" style="white-space: pre-line">{{ p.message }}</p>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-outline-secondary" (click)="confirm.settle(false)">
                {{ p.cancelText }}
              </button>
              <button type="button" class="btn" [class]="p.confirmClass" (click)="confirm.settle(true)">
                {{ p.confirmText }}
              </button>
            </div>
          </div>
        </div>
      </div>
    }
  `,
})
export class ConfirmDialogComponent {
  protected confirm = inject(ConfirmService);

  /** Clicking the dark backdrop (outside the dialog) cancels. */
  onBackdrop(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('modal')) this.confirm.settle(false);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.confirm.pending()) this.confirm.settle(false);
  }
}
