export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const KEY = 'askout.token';

/**
 * Guarda o token de acesso. O armazenamento do navegador pode faltar ou falhar (janela privada,
 * dados bloqueados), então tudo é protegido e há uma cópia em memória como reserva.
 */
export function createSessionStore(storage: StorageLike | undefined) {
  let memory: string | undefined;

  return {
    get(): string | undefined {
      try {
        const stored = storage?.getItem(KEY);
        if (stored) return stored;
      } catch {
        // cai para a memória
      }
      return memory;
    },
    set(token: string): void {
      memory = token;
      try {
        storage?.setItem(KEY, token);
      } catch {
        // fica só na memória
      }
    },
    clear(): void {
      memory = undefined;
      try {
        storage?.removeItem(KEY);
      } catch {
        // nada a fazer
      }
    },
  };
}

export type SessionStore = ReturnType<typeof createSessionStore>;
