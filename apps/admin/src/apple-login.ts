const APPLE_SCRIPT = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/pt_BR/appleid.auth.js';

/** Botão oficial "Continuar com a Apple": a imagem vem do serviço da própria Apple. */
export const APPLE_BUTTON_URL = 'https://appleid.cdn-apple.com/appleid/button?type=continue&color=white&border=false&width=316&height=40&locale=pt_BR';

interface AppleAuth {
  init(config: { clientId: string; scope: string; redirectURI: string; usePopup: boolean }): void;
  signIn(): Promise<{ authorization?: { id_token?: string } }>;
}

let loading: Promise<void> | undefined;
function loadAppleScript(): Promise<void> {
  loading ??= new Promise<void>((resolve, reject) => {
    const el = document.createElement('script');
    el.src = APPLE_SCRIPT;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => {
      loading = undefined;
      reject(new Error('Não foi possível carregar o login da Apple. Verifique sua conexão.'));
    };
    document.head.appendChild(el);
  });
  return loading;
}

/** Abre a janela da Apple e devolve o token de identidade. Fechar a janela devolve undefined. O domínio precisa estar cadastrado no Services ID. */
export async function appleIdToken(clientId: string): Promise<string | undefined> {
  await loadAppleScript();
  const apple = (window as unknown as { AppleID?: { auth?: AppleAuth } }).AppleID?.auth;
  if (!apple) throw new Error('Não foi possível carregar o login da Apple.');
  apple.init({ clientId, scope: 'name email', redirectURI: window.location.origin, usePopup: true });
  try {
    const result = await apple.signIn();
    return result.authorization?.id_token;
  } catch {
    return undefined;
  }
}
