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
  integrations: [
    Sentry.browserTracingIntegration(),
    // Session Replay. Default privacy: all text → ***, media blocked, before it leaves
    // the machine (fits the "scrub" choice for a financial app).
    Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true }),
  ],
  tracesSampleRate: 1.0,
  tracePropagationTargets: [/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//],
  // Buffer a replay in memory and only upload it when an error occurs — so the free-tier
  // 50/month quota is spent solely on sessions that actually broke (rare for one user).
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,
});

bootstrapApplication(AppComponent, appConfig).catch((err) => {
  Sentry.captureException(err);
  console.error(err);
});
