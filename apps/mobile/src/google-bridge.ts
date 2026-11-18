/**
 * Ponte `window.AskouTGoogle`: login com o Google pela janela NATIVA do Android/iPhone.
 * O botão do Google da web não funciona dentro do app: o Google bloqueia login em WebView e a origem do app
 * (https://localhost / capacitor://localhost) não é um site autorizado.
 * Devolve o token de identidade (JWT) do Google, emitido para o cliente WEB (o mesmo `GOOGLE_CLIENT_ID` que a API confere).
 * Devolve undefined quando a pessoa cancela.
 */

export interface GoogleLoginLike {
  initialize(o: {
    google: { webClientId: string; iOSClientId?: string; iOSServerClientId?: string; mode: 'online'; skipAuthOnlyAuthorizationAfterSignIn?: boolean };
  }): Promise<void>;
  login(o: { provider: 'google'; options: Record<string, never> }): Promise<{ result: { idToken?: string | null } }>;
}

export interface GoogleClientIds {
  /** Cliente "Aplicativo da Web" (público do token; o Android também exige este). */
  webClientId: string;
  /** Cliente "iOS" (só iPhone). */
  iosClientId?: string;
}

export function createGoogleBridge(deps: { login: GoogleLoginLike; platform: () => string }) {
  let ready: { key: string; promise: Promise<void> } | undefined;
  return {
    /** No iPhone o login só abre com o cliente iOS (e o URL scheme dele no Info.plist). */
    available(ids: Partial<GoogleClientIds>): boolean {
      if (!ids.webClientId) return false;
      return deps.platform() === 'ios' ? Boolean(ids.iosClientId) : true;
    },
    async signIn(ids: GoogleClientIds): Promise<string | undefined> {
      const ios = deps.platform() === 'ios';
      if (ios && !ids.iosClientId) throw new Error('Login do Google ainda não configurado no iPhone.');
      const key = `${ids.webClientId}|${ios ? ids.iosClientId : ''}`;
      if (!ready || ready.key !== key) {
        const promise = deps.login
          .initialize({
            google: ios
              ? { webClientId: ids.webClientId, iOSClientId: ids.iosClientId, iOSServerClientId: ids.webClientId, mode: 'online' }
              : // Só precisamos do token de identidade: pular a autorização extra evita travar na Activity padrão do Capacitor.
                { webClientId: ids.webClientId, mode: 'online', skipAuthOnlyAuthorizationAfterSignIn: true },
          })
          .catch((e: unknown) => {
            ready = undefined;
            throw e;
          });
        ready = { key, promise };
      }
      await ready.promise;
      try {
        // Sem `scopes`: e-mail e perfil já vêm por padrão, e o Android recusa a lista na Activity padrão.
        const res = await deps.login.login({ provider: 'google', options: {} });
        return res.result.idToken || undefined;
      } catch (e) {
        // Fechar a janela do Google lança erro: tratamos como "não entrou", sem mensagem de falha.
        const text = e instanceof Error ? e.message : String(e);
        if (/cancel|dismiss/i.test(text)) return undefined;
        throw e;
      }
    },
  };
}
