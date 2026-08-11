import type { ExposedApi } from '../../preload/index';

declare global {
  interface Window {
    api: ExposedApi;
  }
}

export {};
