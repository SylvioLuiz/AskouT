import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ConsentFields } from './consent-fields.tsx';
import { Button, Field, Notice } from './ui.tsx';
import { api } from '../client.ts';
import { useAuthContext } from '../auth.tsx';
import { useAsync } from '../hooks.ts';
import { consentProblems } from '../lib/age.ts';
import { toApiError } from '../lib/errors.ts';
import { GOOGLE_SCRIPT, appleIdToken, appleLogoUrl, googleApi, googleMode, loadScript, nativeGoogleBridge, providerLabel } from '../lib/social-login.ts';
import type { SocialNeedsProfile, SocialProviderId } from '../lib/types.ts';
import { usernameProblem, normalizeUsername } from '../lib/validation.ts';
import { getLocale, t } from '../lib/i18n/index.ts';

interface Pending {
  provider: SocialProviderId;
  idToken: string;
  offer: SocialNeedsProfile;
}

/**
 * "Continuar com Google / Apple". Só aparece para as plataformas configuradas na API.
 * Conta nova: pede o nome de usuário antes de criar.
 */
export function SocialLogin() {
  const { signIn } = useAuthContext();
  const providers = useAsync(() => api.socialProviders(), []);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | undefined>();
  const googleItem = providers.data?.items.find((p) => p.provider === 'GOOGLE');
  const gMode = googleItem ? googleMode(googleItem) : 'none';
  /** Dentro do app sem a configuração nativa do Google, o botão some (o da web não funciona no WebView). */
  const google = gMode === 'none' ? undefined : googleItem;
  const apple = providers.data?.items.find((p) => p.provider === 'APPLE');
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

  async function finish(provider: SocialProviderId, idToken: string) {
    setError(undefined);
    setBusy(true);
    try {
      const result = await api.socialLogin({ provider, idToken });
      if ('needsProfile' in result) setPending({ provider, idToken, offer: result });
      else signIn(result);
    } catch (failure) {
      setError(toApiError(failure).message);
    } finally {
      setBusy(false);
    }
  }

  const finishRef = useRef(finish);
  finishRef.current = finish;

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
            if (r.credential) void finishRef.current('GOOGLE', r.credential);
          },
        });
        api2.renderButton(googleBox.current, { type: 'standard', theme: 'outline', size: 'large', text: 'continue_with', shape: 'rectangular', logo_alignment: 'left', locale: getLocale(), width });
      })
      .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : t('Falha ao carregar o login do Google.')));
    return () => {
      cancelled = true;
    };
  }, [google?.clientId, gMode, width]);

  async function withGoogleNative() {
    const bridge = nativeGoogleBridge();
    if (!google || !bridge) return;
    setError(undefined);
    try {
      const idToken = await bridge.signIn({ webClientId: google.clientId, ...(google.iosClientId ? { iosClientId: google.iosClientId } : {}) });
      if (idToken) await finish('GOOGLE', idToken);
    } catch (failure) {
      setError(failure instanceof Error ? t('Falha ao abrir o login do Google: {message}', { message: failure.message }) : t('Falha ao carregar o login do Google.'));
    }
  }

  async function withApple() {
    if (!apple) return;
    setError(undefined);
    try {
      const idToken = await appleIdToken(apple.clientId);
      if (idToken) await finish('APPLE', idToken);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('Falha ao abrir o login da Apple.'));
    }
  }

  if (!google && !apple) return null;

  if (pending) {
    return <ChooseUsername pending={pending} onBack={() => setPending(undefined)} />;
  }

  return (
    <div className="social" ref={box}>
      <p className="social__or">ou</p>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {google && gMode === 'web' ? <div ref={googleBox} className="social__google" aria-busy={busy || undefined} /> : null}
      {google && gMode === 'native' && width > 0 ? (
        <button type="button" className="social__gnative" style={{ width }} aria-busy={busy || undefined} disabled={busy} onClick={() => void withGoogleNative()}>
          <GoogleLogo />
          <span>{t('Continuar com o Google')}</span>
        </button>
      ) : null}
      {apple && width > 0 ? (
        <button type="button" className="social__apple" style={{ width }} aria-busy={busy || undefined} disabled={busy} onClick={() => void withApple()}>
          {appleLogoFailed ? null : <img className="social__apple-logo" src={appleLogoUrl(40)} alt="" width="38" height="38" onError={() => setAppleLogoFailed(true)} />}
          <span>{t('Continuar com a Apple')}</span>
        </button>
      ) : null}
    </div>
  );
}

/** "G" oficial do Google (cores da marca), para o botão nativo dentro do app. */
function GoogleLogo() {
  return (
    <svg className="social__glogo" viewBox="0 0 48 48" width="20" height="20" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

function ChooseUsername({ pending, onBack }: { pending: Pending; onBack: () => void }) {
  const { signIn } = useAuthContext();
  const [username, setUsername] = useState(pending.offer.suggestedUsername);
  const [birth, setBirth] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [consentErrors, setConsentErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const clean = normalizeUsername(username);
    const problem = usernameProblem(clean);
    if (problem) {
      setError(problem);
      return;
    }
    const consent = consentProblems(birth, accepted, new Date());
    setConsentErrors(consent);
    if (Object.keys(consent).length > 0) return;
    setError(undefined);
    setBusy(true);
    try {
      const result = await api.socialLogin({ provider: pending.provider, idToken: pending.idToken, username: clean, displayName: pending.offer.displayName, birthDate: birth, acceptTerms: true, ...(marketing ? { marketingEmail: true } : {}) });
      if ('needsProfile' in result) setError(t('Não foi possível criar a conta. Tente de novo.'));
      else signIn(result);
    } catch (failure) {
      const e = toApiError(failure);
      const f = e.fields;
      setError(f['username'] ?? (f['birthDate'] || f['acceptTerms'] ? undefined : e.message));
      setConsentErrors({ ...(f['birthDate'] ? { birthDate: f['birthDate'] } : {}), ...(f['acceptTerms'] ? { acceptTerms: f['acceptTerms'] } : {}) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form form--flat social__choose" onSubmit={submit} noValidate>
      <h3 className="form__title">{t('Quase lá')}</h3>
      <p className="muted">{t('Escolha seu nome de usuário no AskouT. Sua conta {provider} entra com ele.', { provider: providerLabel(pending.provider) })}</p>
      <Field label={t('Nome de usuário')} value={username} onChange={setUsername} error={error} autoComplete="username" autoFocus />
      <ConsentFields birth={birth} onBirth={setBirth} accepted={accepted} onAccepted={setAccepted} marketing={marketing} onMarketing={setMarketing} errors={consentErrors} />
      <Button type="submit" full loading={busy}>
        {t('Criar conta')}
      </Button>
      <Button variant="quiet" full onClick={onBack}>
        {t('Voltar')}
      </Button>
    </form>
  );
}
