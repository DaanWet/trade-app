import * as Sentry from '@sentry/electron/renderer';
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

// @sentry/electron/renderer talks to the Electron main process over IPC. That bridge
// (window.__SENTRY_IPC__) is set up by the @sentry/electron preload script. It's absent in a
// plain browser (ng serve dev) AND in Electron until the preload is wired — and without it the
// SDK errors with "Fetch API cannot load sentry-ipc://… scheme not supported". So gate init on
// the bridge: no error anywhere, and renderer Sentry auto-enables once the preload is added.
// DSN/scrubbing/release live in the main process; the renderer inherits them over IPC.
const sentryBridge = '__SENTRY_IPC__' in window;

if (sentryBridge) {
  Sentry.init({
    integrations: [
      // pageload/navigation + fetch spans; tracePropagationTargets stitches those fetches
      // into the same trace as the backend (same-origin loopback).
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
}

bootstrapApplication(AppComponent, appConfig).catch((err) => {
  if (sentryBridge) Sentry.captureException(err);
  console.error(err);
});
