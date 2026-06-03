import { Injectable, signal } from '@angular/core';

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  /** Bootstrap button class for the confirm button (e.g. 'btn-primary', 'btn-danger'). */
  confirmClass?: string;
}

interface PendingConfirm extends Required<ConfirmOptions> {
  resolve: (ok: boolean) => void;
}

/**
 * App-wide confirmation dialog, replacing the native window.confirm().
 * Call `await confirm.ask({ message })` from anywhere; a single
 * <app-confirm-dialog> host (mounted in AppComponent) renders the modal.
 */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  /** The currently open request, or null when no dialog is shown. */
  readonly pending = signal<PendingConfirm | null>(null);

  ask(options: ConfirmOptions): Promise<boolean> {
    return new Promise<boolean>(resolve => {
      this.pending.set({
        title: options.title ?? 'Bevestigen',
        message: options.message,
        confirmText: options.confirmText ?? 'Bevestigen',
        cancelText: options.cancelText ?? 'Annuleren',
        confirmClass: options.confirmClass ?? 'btn-primary',
        resolve,
      });
    });
  }

  /** Resolve the open dialog and close it. Called by the host component. */
  settle(ok: boolean): void {
    const p = this.pending();
    if (!p) return;
    this.pending.set(null);
    p.resolve(ok);
  }
}
