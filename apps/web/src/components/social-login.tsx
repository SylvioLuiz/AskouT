import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ConsentFields } from './consent-fields.tsx';
import { Button, Field, Notice } from './ui.tsx';
import { api } from '../client.ts';
import { useAuthContext } from '../auth.tsx';
import { useAsync } from '../hooks.ts';
import { consentProblems } from '../lib/age.ts';
import { toApiError } from '../lib/errors.ts';
import { GOOGLE_SCRIPT, appleIdToken, googleApi, loadScript, providerLabel } from '../lib/social-login.ts';
import type { SocialNeedsProfile, SocialProviderId } from '../lib/types.ts';
import { usernameProblem, normalizeUsername } from '../lib/validation.ts';
import { t } from '../lib/i18n/index.ts';

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
  const google = providers.data?.items.find((p) => p.provider === 'GOOGLE');
  const apple = providers.data?.items.find((p) => p.provider === 'APPLE');
  const googleBox = useRef<HTMLDivElement>(null);

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
    if (!google || !googleBox.current) return;
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
        api2.renderButton(googleBox.current, { type: 'standard', theme: 'outline', size: 'large', text: 'continue_with', shape: 'pill', locale: 'pt-BR', width: Math.min(360, googleBox.current.clientWidth || 320) });
      })
      .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : t('Falha ao carregar o login do Google.')));
    return () => {
      cancelled = true;
    };
  }, [google?.clientId]);

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
    <div className="social">
      <p className="social__or">ou</p>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {google ? <div ref={googleBox} className="social__google" aria-busy={busy || undefined} /> : null}
      {apple ? (
        <Button variant="secondary" full loading={busy} onClick={() => void withApple()}>
          {t('Continuar com a Apple')}
        </Button>
      ) : null}
    </div>
  );
}

function ChooseUsername({ pending, onBack }: { pending: Pending; onBack: () => void }) {
  const { signIn } = useAuthContext();
  const [username, setUsername] = useState(pending.offer.suggestedUsername);
  const [birth, setBirth] = useState('');
  const [accepted, setAccepted] = useState(false);
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
      const result = await api.socialLogin({ provider: pending.provider, idToken: pending.idToken, username: clean, displayName: pending.offer.displayName, birthDate: birth, acceptTerms: true });
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
      <p className="muted">Escolha seu nome de usuário no AskouT. Sua conta {providerLabel(pending.provider)} entra com ele.</p>
      <Field label={t('Nome de usuário')} value={username} onChange={setUsername} error={error} autoComplete="username" autoFocus />
      <ConsentFields birth={birth} onBirth={setBirth} accepted={accepted} onAccepted={setAccepted} errors={consentErrors} />
      <Button type="submit" full loading={busy}>
        {t('Criar conta')}
      </Button>
      <Button variant="quiet" full onClick={onBack}>
        {t('Voltar')}
      </Button>
    </form>
  );
}
