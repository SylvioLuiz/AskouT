/**
 * Ponte `window.AskouTApple`: login com a Apple pela janela NATIVA do iPhone (o botão da web não funciona dentro do app).
 * Devolve o token de identidade (JWT) da Apple, que o servidor confere (público = bundle id, `APPLE_APP_ID`).
 * Devolve undefined quando a pessoa cancela.
 */

export interface AppleLoginLike {
  initialize(o: { apple: Record<string, never> }): Promise<void>;
  login(o: { provider: 'apple'; options: { scopes: string[] } }): Promise<{ result: { idToken?: string | null } }>;
}

export function createAppleBridge(deps: { login: AppleLoginLike }) {
  let ready: Promise<void> | undefined;
  return {
    async signIn(): Promise<string | undefined> {
      ready ??= deps.login.initialize({ apple: {} }).catch((e: unknown) => {
        ready = undefined;
        throw e;
      });
      await ready;
      try {
        const res = await deps.login.login({ provider: 'apple', options: { scopes: ['email', 'name'] } });
        return res.result.idToken || undefined;
      } catch (e) {
        // Cancelar a janela da Apple lança erro: tratamos como "não entrou", sem mensagem de falha.
        const text = e instanceof Error ? e.message : String(e);
        if (/cancel|1001|dismiss/i.test(text)) return undefined;
        throw e;
      }
    },
  };
}
