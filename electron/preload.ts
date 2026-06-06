// Wires the @sentry/electron IPC bridge (window.__SENTRY_IPC__) so the renderer SDK reaches
// the main process over Electron IPC instead of the unsupported `sentry-ipc://` protocol
// fetch. Without it, renderer errors/replay/traces never reach Sentry. Requires sandbox:false
// on the BrowserWindow (a sandboxed preload can't require this node module).
import '@sentry/electron/preload';

// Reserved for future contextBridge APIs (file dialogs, native menus, etc.).
export {};
