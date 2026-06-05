// Reserved for future contextBridge APIs (file dialogs, native menus, etc.).
// Kept minimal so the renderer talks to Express via fetch like in the browser.
//
// NOTE: to enable @sentry/electron renderer capture (errors/replay/traces) in the packaged
// app, add `import '@sentry/electron/preload';` here AND set `sandbox: false` on the
// BrowserWindow (a sandboxed preload can't require this node module), or bundle the preload.
export {};
