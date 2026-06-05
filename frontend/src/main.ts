import * as Sentry from '@sentry/electron/renderer';
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

// Captures renderer (Angular) errors + traces and forwards them to the main process' Sentry.
// In a plain browser (ng serve, no Electron main) this is a harmless no-op. DSN, scrubbing
// and release/environment live in the main process; the renderer inherits them over IPC.
// browserTracingIntegration adds pageload/navigation + fetch spans; tracePropagationTargets
// stitches those fetches into the same trace as the backend (same-origin loopback).
Sentry.init({
  integrations: [Sentry.browserTracingIntegration()],
  tracesSampleRate: 1.0,
  tracePropagationTargets: [/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//],
});

bootstrapApplication(AppComponent, appConfig).catch((err) => {
  Sentry.captureException(err);
  console.error(err);
});
