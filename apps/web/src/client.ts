import { createApi } from './lib/api.ts';
import { createSessionStore } from './lib/session.ts';
import type { StorageLike } from './lib/session.ts';

function browserStorage(): StorageLike | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export const session = createSessionStore(browserStorage());

let onUnauthorized: () => void = () => {};

/** O provedor de autenticação registra aqui o que fazer quando a sessão expira. */
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

const baseUrl = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';

export const api = createApi({
  baseUrl,
  fetch: (input, init) => window.fetch(input, init),
  getToken: () => session.get(),
  onUnauthorized: () => onUnauthorized(),
});
