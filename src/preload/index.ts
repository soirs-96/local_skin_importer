import { contextBridge } from 'electron';

// Placeholder preload. Tasks 12-15 will fill in the real API surface
// (lcu:check-status, auth:login, backend:sync, etc.). Exposing an empty
// `api` object now so the renderer can guard on `window.api` without
// crashing during Task 11 smoke-builds.
contextBridge.exposeInMainWorld('api', {});

export type ExposedApi = Record<string, never>;
