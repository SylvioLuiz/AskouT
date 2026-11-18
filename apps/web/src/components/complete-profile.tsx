import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { ConsentFields } from './consent-fields.tsx';
import { Avatar, Button, Field, Notice } from './ui.tsx';
import { api } from '../client.ts';
import { useAuthContext, useUser } from '../auth.tsx';
import { useTitle } from '../hooks.ts';
import { consentProblems } from '../lib/age.ts';
import { toApiError } from '../lib/errors.ts';
import { normalizeUsername, usernameProblem } from '../lib/validation.ts';
import { t } from '../lib/i18n/index.ts';

type Check = { state: 'idle' } | { state: 'checking' } | { state: 'ok' } | { state: 'bad'; message: string };

/**
 * "Complete seu cadastro", no estilo do Instagram/TikTok: a conta já foi criada pelo Google/Apple e a pessoa já está logada.
 * Passo 1: nome de usuário (vem sugerido, confere na hora se está livre). Passo 2: data de nascimento e aceite dos Termos.
 * Enquanto não concluir, o app não abre a tela inicial, nem depois de sair e entrar de novo.
 */
export function CompleteProfileScreen() {
  useTitle(t('Complete seu cadastro'));
  const user = useUser();
  const { signOut, setSessionUser } = useAuthContext();
  const [step, setStep] = useState<1 | 2>(1);
  const [username, setUsername] = useState(user.profile.username);
  const [check, setCheck] = useState<Check>({ state: 'ok' });
  const [birth, setBirth] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [consentErrors, setConsentErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const clean = normalizeUsername(username);

  // Confere o nome enquanto a pessoa digita (espera ela parar um pouco).
  useEffect(() => {
    const local = usernameProblem(clean);
    if (local) {
      setCheck({ state: 'bad', message: local });
      return;
    }
    if (clean === user.profile.username) {
      setCheck({ state: 'ok' });
      return;
    }
    setCheck({ state: 'checking' });
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api.usernameAvailable(clean).then(
        (r) => {
          if (!cancelled) setCheck(r.available ? { state: 'ok' } : { state: 'bad', message: r.problem ?? t('Este nome de usuário já está em uso') });
        },
        () => {
          if (!cancelled) setCheck({ state: 'idle' }); // sem conexão: a API confere de novo ao concluir
        },
      );
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [clean, user.profile.username]);

  function next(event: FormEvent) {
    event.preventDefault();
    const local = usernameProblem(clean);
    if (local) {
      setCheck({ state: 'bad', message: local });
      return;
    }
    if (check.state === 'bad' || check.state === 'checking') return;
    setError(undefined);
    setStep(2);
  }

  async function finish(event: FormEvent) {
    event.preventDefault();
    const consent = consentProblems(birth, accepted, new Date());
    setConsentErrors(consent);
    if (Object.keys(consent).length > 0) return;
    setError(undefined);
    setBusy(true);
    try {
      const updated = await api.completeProfile({ username: clean, birthDate: birth, acceptTerms: true, ...(marketing ? { marketingEmail: true } : {}) });
      setSessionUser(updated);
    } catch (failure) {
      const e = toApiError(failure);
      const f = e.fields;
      if (f['username']) {
        setCheck({ state: 'bad', message: f['username'] });
        setStep(1);
      }
      setConsentErrors({ ...(f['birthDate'] ? { birthDate: f['birthDate'] } : {}), ...(f['acceptTerms'] ? { acceptTerms: f['acceptTerms'] } : {}) });
      if (!f['username'] && !f['birthDate'] && !f['acceptTerms']) setError(e.message);
      setBusy(false);
    }
  }

  const hint =
    check.state === 'checking' ? t('Conferindo…') : check.state === 'ok' ? t('Disponível') : undefined;

  return (
    <main className="completeprofile" aria-labelledby="completeprofile-title">
      <div className="completeprofile__card">
        <p className="completeprofile__steps" aria-label={t('Passo {step} de 2', { step })}>
          <span className={step >= 1 ? 'is-on' : ''} />
          <span className={step >= 2 ? 'is-on' : ''} />
        </p>
        {step === 1 ? (
          <form className="form form--flat" onSubmit={next} noValidate>
            <div className="completeprofile__who">
              <Avatar profile={{ ...user.profile, username: clean || user.profile.username }} size={72} />
            </div>
            <h1 id="completeprofile-title" className="form__title">
              {t('Crie um nome de usuário')}
            </h1>
            <p className="muted">{t('É assim que as pessoas vão te encontrar no AskouT. Sugerimos um, mas você pode escolher outro.')}</p>
            {error ? <Notice tone="error">{error}</Notice> : null}
            <Field label={t('Nome de usuário')} prefix="@" value={username} onChange={setUsername} error={check.state === 'bad' ? check.message : undefined} hint={hint} autoComplete="username" autoFocus maxLength={30} />
            <Button type="submit" full disabled={check.state === 'bad' || check.state === 'checking'}>
              {t('Avançar')}
            </Button>
          </form>
        ) : (
          <form className="form form--flat" onSubmit={(e) => void finish(e)} noValidate>
            <h1 id="completeprofile-title" className="form__title">
              {t('Qual é a sua data de nascimento?')}
            </h1>
            <p className="muted">{t('Use a sua própria data. Ela não aparece no seu perfil e serve para confirmar que você tem 18 anos ou mais.')}</p>
            {error ? <Notice tone="error">{error}</Notice> : null}
            <ConsentFields birth={birth} onBirth={setBirth} accepted={accepted} onAccepted={setAccepted} marketing={marketing} onMarketing={setMarketing} errors={consentErrors} />
            <Button type="submit" full loading={busy}>
              {t('Concluir cadastro')}
            </Button>
            <Button variant="quiet" full onClick={() => setStep(1)} disabled={busy}>
              {t('Voltar')}
            </Button>
          </form>
        )}
        <p className="completeprofile__foot">
          {t('Entrou como {email}.', { email: user.email })}{' '}
          <button type="button" className="linkbtn" onClick={signOut}>
            {t('Sair')}
          </button>
        </p>
      </div>
    </main>
  );
}
