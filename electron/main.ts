import { app, BrowserWindow, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import path from 'path';
import fs from 'fs';
import Module from 'module';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { initSentry, sentrySink, type BackendLogEvent } from './sentry';

// Init Sentry first so a throw during the backend require (below) is still captured.
// DSN-gated: with no SENTRY_DSN this is a no-op and the backend stays fully local.
const sentryEnabled = initSentry({
  release: `trade-app@${app.getVersion()}`,
  environment: app.isPackaged ? 'production' : 'development',
});

const isPackaged = app.isPackaged;

// Resolve resource paths. When packaged, `app.getAppPath()` returns the asar
// (or unpacked) root; in dev it returns the project root.
const appRoot = app.getAppPath();
const backendAppPath = path.join(appRoot, 'backend', 'dist', 'app.js');
const frontendDir = path.join(appRoot, 'frontend', 'dist', 'frontend', 'browser');

// Force native modules to resolve against the ROOT node_modules so we always
// load the binary rebuilt for Electron's ABI (electron-builder rebuilds root
// deps but not backend/node_modules — keeping that intact for backend dev).
const NATIVE_OVERRIDES = new Set(['better-sqlite3']);
const rootModulesDir = path.join(appRoot, 'node_modules');
const origResolve = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (request: string, parent: NodeJS.Module, ...rest: unknown[]) {
  if (NATIVE_OVERRIDES.has(request)) {
    return origResolve.call(this, path.join(rootModulesDir, request), parent, ...rest);
  }
  return origResolve.call(this, request, parent, ...rest);
};

// User-writable data dir for the SQLite database. Survives app updates.
const userData = app.getPath('userData');
const dataDir = path.join(userData, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, 'trades.db');

// Inject env BEFORE requiring backend so its top-level reads pick them up.
process.env.DB_PATH = dbPath;
process.env.STATIC_DIR = frontendDir;
// Persistent logs next to the DB in userData, so they survive restarts and updates.
process.env.LOG_DIR = path.join(userData, 'logs');
// Surface the app version on GET /api/diagnostics (and in log lines).
process.env.APP_VERSION = app.getVersion();
// Same-origin in Electron, but keep CORS permissive for any electron:// quirks.
process.env.CORS_ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost';

let server: Server | null = null;
let mainWindow: BrowserWindow | null = null;

async function startBackend(): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const backend = require(backendAppPath) as {
    app: import('express').Express;
    setRemoteSink: (fn: ((ev: BackendLogEvent, err?: unknown) => void) | null) => void;
  };
  const expressApp = backend.app;

  // Route the backend logger's events to Sentry (breadcrumbs + error capture). Injected
  // here so the backend never imports Electron/Sentry; skipped entirely when DSN is absent.
  if (sentryEnabled) backend.setRemoteSink(sentrySink);

  return new Promise<number>((resolve, reject) => {
    server = expressApp.listen(0, '127.0.0.1', () => {
      const addr = server!.address() as AddressInfo;
      console.log(`[electron] backend listening on http://127.0.0.1:${addr.port}`);
      console.log(`[electron] db: ${dbPath}`);
      resolve(addr.port);
    });
    server.on('error', reject);
  });
}

function createWindow(port: number): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    title: 'Trade App',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => { mainWindow = null; });

  // Open external links in the user's browser instead of new Electron windows.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (!isPackaged) mainWindow.webContents.openDevTools({ mode: 'detach' });

  mainWindow.loadURL(`http://127.0.0.1:${port}/`);
}

app.whenReady().then(async () => {
  try {
    const port = await startBackend();
    createWindow(port);
  } catch (err) {
    console.error('[electron] failed to start backend', err);
    app.quit();
  }

  // Auto-updates: only meaningful in packaged builds (uses publish config)
  if (isPackaged) {
    autoUpdater.logger = console;
    autoUpdater.checkForUpdatesAndNotify().catch(err => {
      console.error('[electron] update check failed', err);
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && server) {
      const addr = server.address() as AddressInfo;
      createWindow(addr.port);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (server) {
    server.close();
    server = null;
  }
});
