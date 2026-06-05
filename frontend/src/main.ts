import * as Sentry from '@sentry/electron/renderer';
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

// Captures renderer (Angular) errors and forwards them to the main process' Sentry.
// In a plain browser (ng serve, no Electron main) this is a harmless no-op. Config (DSN,
// scrubbing) lives in the main process; the renderer inherits it over IPC.
Sentry.init({});

bootstrapApplication(AppComponent, appConfig).catch((err) => {
  Sentry.captureException(err);
  console.error(err);
});
