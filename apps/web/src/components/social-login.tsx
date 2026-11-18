import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Notice } from './ui.tsx';
import { api } from '../client.ts';
import { useAuthContext } from '../auth.tsx';
import { useAsync } from '../hooks.ts';
import { toApiError } from '../lib/errors.ts';
import { GOOGLE_SCRIPT, appleIdToken, appleLogoUrl, googleApi, googleMode, loadScript, nativeGoogleBridge, providerLabel } from '../lib/social-login.ts';
import type { SocialProviderId } from '../lib/types.ts';
import { getLocale, t } from '../lib/i18n/index.ts';

interface ButtonsProps {
  /** Token de identidade da plataforma, depois que a pessoa escolheu a conta. */
  onToken: (provider: SocialProviderId, idToken: string) => Promise<void>;
  /** Só estas plataformas (padrão: todas as configuradas). */
  only?: readonly SocialProviderId[];
  busy?: boolean;
  /** Texto do botão: "Continuar com…" na entrada, "Conectar…" nas contas vinculadas. */
  verb?: 'continue' | 'connect';
}

/** Botões oficiais do Google e da Apple (o nativo dentro do app, o da web no navegador). Reaproveitado na entrada e nas contas vinculadas. */
export function SocialButtons({ onToken, only, busy = false, verb = 'continue' }: ButtonsProps) {
  const providers = useAsync(() => api.socialProviders(), []);
  const [error, setError] = useState<string | undefined>();
  const allowed = (p: SocialProviderId) => !only || only.includes(p);
  const googleItem = providers.data?.items.find((p) => p.provider === 'GOOGLE' && allowed('GOOGLE'));
  const gMode = googleItem ? googleMode(googleItem) : 'none';
  /** Dentro do app sem a configuração nativa do Google, o botão some (o da web não funciona no WebView). */
  const google = gMode === 'none' ? undefined : googleItem;
  const apple = providers.data?.items.find((p) => p.provider === 'APPLE' && allowed('APPLE'));
  const googleBox = useRef<HTMLDivElement>(null);
  const [appleLogoFailed, setAppleLogoFailed] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  /** Largura dos dois botões (Google e Apple), iguais e medidas na tela. */
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const measure = () => setWidth(Math.max(200, Math.min(360, Math.floor(box.current?.clientWidth ?? 0))));
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [google !== undefined || apple !== undefined]);

  async function deliver(provider: SocialProviderId, idToken: string) {
    setError(undefined);
    try {
      await onToken(provider, idToken);
    } catch (failure) {
      setError(toApiError(failure).message);
    }
  }

  const deliverRef = useRef(deliver);
  deliverRef.current = deliver;

  useEffect(() => {
    if (!google || gMode !== 'web' || !googleBox.current || width === 0) return;
    let cancelled = false;
    loadScript(GOOGLE_SCRIPT)
      .then(() => {
        const api2 = googleApi();
        if (cancelled || !api2 || !googleBox.current) return;
        api2.initialize({
          client_id: google.clientId,
          ux_mode: 'popup',
          callback: (r) => {
            if (r.credential) void deliverRef.current('GOOGLE', r.credential);
          },
        });
        api2.renderButton(googleBox.current, { type: 'standard', theme: 'outline', size: 'large', text: verb === 'connect' ? 'signin_with' : 'continue_with', shape: 'rectangular', logo_alignment: 'left', locale: getLocale(), width });
      })
      .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : t('Falha ao carregar o login do Google.')));
    return () => {
      cancelled = true;
    };
  }, [google?.clientId, gMode, width, verb]);

  async function withGoogleNative() {
    const bridge = nativeGoogleBridge();
    if (!google || !bridge) return;
    setError(undefined);
    try {
      const idToken = await bridge.signIn({ webClientId: google.clientId, ...(google.iosClientId ? { iosClientId: google.iosClientId } : {}) });
      if (idToken) await deliver('GOOGLE', idToken);
    } catch (failure) {
      setError(failure instanceof Error ? t('Falha ao abrir o login do Google: {message}', { message: failure.message }) : t('Falha ao carregar o login do Google.'));
    }
  }

  async function withApple() {
    if (!apple) return;
    setError(undefined);
    try {
      const idToken = await appleIdToken(apple.clientId);
      if (idToken) await deliver('APPLE', idToken);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('Falha ao abrir o login da Apple.'));
    }
  }

  if (!google && !apple) return null;

  return (
    <div className="social__buttons" ref={box}>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {google && gMode === 'web' ? <div ref={googleBox} className="social__google" aria-busy={busy || undefined} /> : null}
      {google && gMode === 'native' && width > 0 ? (
        <button type="button" className="social__gnative" style={{ width }} aria-busy={busy || undefined} disabled={busy} onClick={() => void withGoogleNative()}>
          <GoogleLogo />
          <span>{verb === 'connect' ? t('Conectar com o Google') : t('Continuar com o Google')}</span>
        </button>
      ) : null}
      {apple && width > 0 ? (
        <button type="button" className="social__apple" style={{ width }} aria-busy={busy || undefined} disabled={busy} onClick={() => void withApple()}>
          {appleLogoFailed ? null : <img className="social__apple-logo" src={appleLogoUrl(40)} alt="" width="38" height="38" onError={() => setAppleLogoFailed(true)} />}
          <span>{verb === 'connect' ? t('Conectar com a Apple') : t('Continuar com a Apple')}</span>
        </button>
      ) : null}
    </div>
  );
}

/**
 * "Continuar com Google / Apple" na entrada. Só aparece para as plataformas configuradas na API.
 * Conta nova é criada na hora e já entra; o nome de usuário e a data de nascimento vêm na etapa seguinte, já logado.
 */
export function SocialLogin() {
  const { signIn } = useAuthContext();
  const providers = useAsync(() => api.socialProviders(), []);
  const [busy, setBusy] = useState(false);
  const any = (providers.data?.items.length ?? 0) > 0;

  async function finish(provider: SocialProviderId, idToken: string) {
    setBusy(true);
    try {
      const result = await api.socialLogin({ provider, idToken });
      if ('needsProfile' in result) throw new Error(t('Atualize o app para criar sua conta com {provider}.', { provider: providerLabel(provider) }));
      signIn(result);
    } finally {
      setBusy(false);
    }
  }

  if (!any) return null;
  return (
    <div className="social">
      <p className="social__or">ou</p>
      <SocialButtons onToken={finish} busy={busy} />
    </div>
  );
}

/** "G" oficial do Google (cores da marca), para o botão nativo dentro do app. */
export function GoogleLogo() {
  return (
    <svg className="social__glogo" viewBox="0 0 48 48" width="20" height="20" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
