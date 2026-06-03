import { Injectable, signal } from '@angular/core';
import { EMPTY, Observable, catchError, from, switchMap, throwError } from 'rxjs';

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

  /**
   * Run a mutation that may answer `409 { code: 'CASH_OVERDRAW' }`. On that response,
   * show the shared overdraw warning and, if the user confirms, retry once with
   * confirm=true. Cancelling completes silently (no emit, no error). Any other error
   * propagates to the subscriber unchanged.
   */
  confirmOnCashOverdraw<T>(
    run: (confirm: boolean) => Observable<T>,
    opts: { confirmText: string; question?: string },
  ): Observable<T> {
    return run(false).pipe(
      catchError(err => {
        if (err?.status !== 409 || err?.error?.code !== 'CASH_OVERDRAW') return throwError(() => err);
        return from(
          this.ask({
            title: 'Onvoldoende cash',
            message: `${err.error.error}\n\n${opts.question ?? 'Toch doorgaan?'}`,
            confirmText: opts.confirmText,
            confirmClass: 'btn-warning',
          }),
        ).pipe(switchMap(ok => (ok ? run(true) : EMPTY)));
      }),
    );
  }
}
