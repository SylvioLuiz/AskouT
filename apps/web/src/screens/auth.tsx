import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { AuthLayout } from '../components/AuthLayout.tsx';
import { ConsentFields } from '../components/consent-fields.tsx';
import { SocialLogin } from '../components/social-login.tsx';
import { MfaStep } from '../components/mfa-step.tsx';
import { consentProblems } from '../lib/age.ts';
import { Button, Field, Notice, PasswordField } from '../components/ui.tsx';
import { api } from '../client.ts';
import { useAuthContext } from '../auth.tsx';
import { useTitle } from '../hooks.ts';
import { toApiError } from '../lib/errors.ts';
import { formatCountdown, secondsUntil } from '../lib/format.ts';
import type { MfaChallenge, PasswordResetStarted, SignupStarted } from '../lib/types.ts';
import {
  codeProblem,
  compact,
  displayNameProblem,
  emailProblem,
  loginIdentifierProblem,
  normalizeUsername,
  passwordProblem,
  usernameProblem,
} from '../lib/validation.ts';
import { parseInvite, rememberInvite } from '../lib/invite.ts';
import { formatPhone, normalizePhone } from '../lib/phone.ts';
import { safeStorage } from '../lib/hints.ts';
import { ChevronLeftIcon } from '../components/icons.tsx';
import { Link, navigate, useSearch } from '../router.tsx';
import { t } from '../lib/i18n/index.ts';
import { isNativeApp, storeLinks } from '../lib/store-links.ts';

function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const handle = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(handle);
  }, [intervalMs]);
  return now;
}

/** "<" no canto de cima à esquerda das telas de código. */
function BackButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="pagehead__back form__back" aria-label={t('Voltar')} onClick={onClick} disabled={disabled}>
      <ChevronLeftIcon />
    </button>
  );
}

type LoginTab = 'email' | 'phone';

export function LoginScreen() {
  useTitle(t('Entrar'));
  const { signIn } = useAuthContext();
  const expired = useSearch().get('expirou') === '1';
  const [tab, setTab] = useState<LoginTab>('email');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  // Celular: etapa 1 só com o número; a etapa 2 (código) fica aqui mesmo, para "voltar" manter o número digitado.
  const [phoneChallenge, setPhoneChallenge] = useState<MfaChallenge | undefined>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  function switchTab(next: LoginTab) {
    if (next === tab || busy) return;
    setTab(next);
    setErrors({});
    setFormError(undefined);
  }

  function fail(failure: unknown) {
    const error = toApiError(failure);
    if (error.fields['socialProvider']) {
      // Conta criada pelo Google/Apple, sem senha: avisa por onde ela entra.
      setErrors({});
      setFormError(error.message);
    } else {
      setErrors(error.fields);
      setFormError(Object.keys(error.fields).length === 0 ? error.message : undefined);
    }
    setBusy(false);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found =
      tab === 'email'
        ? compact({
            identifier: loginIdentifierProblem(identifier),
            password: password === '' ? t('Informe sua senha') : undefined,
          })
        : compact({
            phone: phone.trim() === '' ? t('Informe seu celular') : normalizePhone(phone) ? undefined : t('Informe o celular com DDD, ex.: (99) 99999-9999'),
          });
    setErrors(found);
    setFormError(undefined);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    try {
      if (tab === 'email') {
        signIn(await api.login(identifier.trim(), password));
      } else {
        setPhoneChallenge(await api.phoneLogin(phone.trim()));
        setBusy(false);
      }
    } catch (failure) {
      fail(failure);
    }
  }

  if (phoneChallenge) {
    const e164 = normalizePhone(phone);
    return (
      <MfaStep
        challenge={phoneChallenge}
        subtitle={t('Entrando com o celular {phone}.', { phone: e164 ? formatPhone(e164) : phone.trim() })}
        backLabel={t('Trocar número')}
        onDone={signIn}
        onCancel={() => setPhoneChallenge(undefined)}
      />
    );
  }

  return (
    <AuthLayout fit>
      <form className="form" onSubmit={submit} noValidate>
        <h2 className="form__title">{t('Entrar')}</h2>
        <div className="segtabs segtabs--fill" role="tablist" aria-label={t('Entrar com')}>
          <button type="button" role="tab" aria-selected={tab === 'email'} className="segtabs__tab" onClick={() => switchTab('email')}>
            {t('E-mail')}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'phone'} className="segtabs__tab" onClick={() => switchTab('phone')}>
            {t('Telefone')}
          </button>
        </div>
        {expired ? <Notice tone="info">{t('Sua sessão expirou. Entre de novo para continuar.')}</Notice> : null}
        {formError ? <Notice tone="error">{formError}</Notice> : null}
        {tab === 'email' ? (
          <>
            <Field label={t('E-mail ou @usuário')} value={identifier} onChange={setIdentifier} error={errors['identifier']} autoComplete="username" autoFocus />
            <PasswordField label={t('Senha')} value={password} onChange={setPassword} error={errors['password']} autoComplete="current-password" />
          </>
        ) : (
          <>
            <Field
              label={t('Celular')}
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={setPhone}
              error={errors['phone']}
              autoComplete="tel"
              maxLength={25}
              placeholder="(99) 99999-9999"
              autoFocus
              hint={t('Sem senha: depois você confirma com o código do app autenticador. Ative em Configurações > Verificação em duas etapas, com o celular salvo no seu perfil.')}
            />
          </>
        )}
        <Button type="submit" full loading={busy}>
          {tab === 'email' ? t('Entrar') : t('Continuar')}
        </Button>
        <p className="form__switch form__switch--row">
          <Link to="/esqueci-senha">{t('Esqueci minha senha')}</Link>
          <Link to="/cadastro">{t('Criar conta')}</Link>
        </p>
      </form>
      <SocialLogin />
      <LegalNote />
      <StoreBadges />
    </AuthLayout>
  );
}

/** No navegador, o rodapé da entrada leva para o app nas lojas. Dentro do app não aparece. */
function StoreBadges() {
  if (isNativeApp()) return null;
  const links = storeLinks({
    apple: import.meta.env.VITE_APP_STORE_URL as string | undefined,
    google: import.meta.env.VITE_PLAY_STORE_URL as string | undefined,
  });
  if (!links.apple && !links.google) return null;
  return (
    <nav className="auth__stores" aria-label={t('Baixe o app')}>
      <span className="auth__stores-label">{t('Baixe o app')}</span>
      <div className="auth__stores-row">
        {links.apple ? (
          <a className="store-badge" href={links.apple} target="_blank" rel="noopener noreferrer">
            <svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18">
              <path fill="currentColor" d="M16.37 12.6c-.02-2.2 1.8-3.26 1.88-3.31-1.03-1.5-2.62-1.7-3.18-1.73-1.35-.14-2.64.8-3.33.8-.69 0-1.74-.78-2.87-.76-1.47.02-2.83.86-3.59 2.18-1.54 2.66-.39 6.6 1.1 8.76.73 1.06 1.6 2.24 2.73 2.2 1.1-.05 1.51-.71 2.84-.71 1.32 0 1.7.71 2.86.69 1.18-.02 1.93-1.07 2.65-2.13.84-1.22 1.18-2.4 1.2-2.46-.03-.01-2.3-.88-2.3-3.5ZM14.2 6.13c.6-.73 1.01-1.75.9-2.76-.87.04-1.92.58-2.55 1.31-.56.65-1.05 1.69-.92 2.68.97.08 1.96-.49 2.57-1.23Z" />
            </svg>
            <span>{t('App Store')}</span>
          </a>
        ) : null}
        {links.google ? (
          <a className="store-badge" href={links.google} target="_blank" rel="noopener noreferrer">
            <svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18">
              <path fill="currentColor" d="M4.2 2.6c-.25.26-.4.67-.4 1.2v16.4c0 .53.15.94.4 1.2l.07.06 9.19-9.19v-.22L4.27 2.54l-.07.06Zm12.32 12.53-3.06-3.06v-.22l3.06-3.06.07.04 3.63 2.06c1.04.59 1.04 1.55 0 2.14l-3.63 2.06-.07.04Zm.07-.04L13.46 12l-9.26 9.26c.34.36.9.4 1.54.05l10.85-6.22M16.59 8.91 5.74 2.69c-.64-.36-1.2-.32-1.54.05L13.46 12l3.13-3.09Z" />
            </svg>
            <span>{t('Google Play')}</span>
          </a>
        ) : null}
      </div>
    </nav>
  );
}

/** Aviso de aceite com os links dos textos legais. */
function LegalNote() {
  return (
    <p className="auth__legal">
      Ao continuar, você concorda com os <Link to="/termos-de-uso">{t('Termos de Uso')}</Link> e com a <Link to="/politica-de-privacidade">{t('Política de Privacidade')}</Link>.
    </p>
  );
}

export function SignupScreen() {
  useTitle(t('Criar conta'));
  const { signIn } = useAuthContext();
  // Link de convite (?convite=usuario): guarda quem convidou; o onboarding passa a seguir essa pessoa depois do cadastro.
  const invitedBy = parseInvite(useSearch().get('convite'));
  useEffect(() => {
    if (invitedBy) rememberInvite(safeStorage(), invitedBy);
  }, [invitedBy]);
  const [started, setStarted] = useState<SignupStarted | undefined>();

  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [birth, setBirth] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [code, setCode] = useState('');

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | undefined>();
  const [info, setInfo] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const now = useNow();

  async function submitDetails(event: FormEvent) {
    event.preventDefault();
    const handle = normalizeUsername(username);
    const found = compact({
      email: emailProblem(email),
      username: usernameProblem(handle),
      displayName: displayNameProblem(displayName, false),
      password: passwordProblem(password),
      ...consentProblems(birth, accepted, new Date()),
    });
    setErrors(found);
    setFormError(undefined);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    try {
      const result = await api.startSignup({
        email: email.trim(),
        username: handle,
        password,
        birthDate: birth,
        acceptTerms: true,
        ...(marketing ? { marketingEmail: true } : {}),
        ...(displayName.trim() !== '' ? { displayName: displayName.trim() } : {}),
      });
      setStarted(result);
      setCode('');
      setErrors({});
    } catch (failure) {
      const error = toApiError(failure);
      setErrors(error.fields);
      setFormError(Object.keys(error.fields).length === 0 ? error.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(event: FormEvent) {
    event.preventDefault();
    if (!started) return;
    const found = compact({ code: codeProblem(code) });
    setErrors(found);
    setFormError(undefined);
    setInfo(undefined);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    try {
      signIn(await api.confirmSignup(started.email, code.trim()));
    } catch (failure) {
      const error = toApiError(failure);
      setErrors(error.fields);
      setFormError(Object.keys(error.fields).length === 0 ? error.message : undefined);
      setBusy(false);
    }
  }

  async function resend() {
    if (!started) return;
    setBusy(true);
    setFormError(undefined);
    setInfo(undefined);
    try {
      setStarted(await api.resendSignupCode(started.email));
      setCode('');
      setErrors({});
      setInfo(t('Enviamos um novo código. O anterior deixou de valer.'));
    } catch (failure) {
      setFormError(toApiError(failure).message);
    } finally {
      setBusy(false);
    }
  }

  function backToDetails() {
    setStarted(undefined);
    setErrors({});
    setFormError(undefined);
    setInfo(undefined);
  }

  if (started) {
    const wait = secondsUntil(started.resendAvailableAt, now);
    return (
      <AuthLayout>
        <form className="form" onSubmit={submitCode} noValidate>
          <BackButton onClick={backToDetails} disabled={busy} />
          <h2 className="form__title">{t('Confirme seu e-mail')}</h2>
          <p className="form__text">
            {t('Enviamos um código de 6 números para')} <strong>{started.email}</strong>. {t('Ele vale por 10 minutos.')}
          </p>
          {import.meta.env.DEV ? (
            <Notice tone="info">{t('Ambiente de desenvolvimento: o código não chega por e-mail, aparece no log da API.')}</Notice>
          ) : null}
          {info ? <Notice tone="ok">{info}</Notice> : null}
          {formError ? <Notice tone="error">{formError}</Notice> : null}
          <Field label={t('Código')} value={code} onChange={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} error={errors['code']} inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus />
          <Button type="submit" full loading={busy}>
            {t('Confirmar e entrar')}
          </Button>
          <div className="form__row">
            <Button variant="quiet" small onClick={resend} disabled={busy || wait > 0}>
              {wait > 0 ? t('Reenviar código em {wait}', { wait: formatCountdown(wait) }) : t('Reenviar código')}
            </Button>
            <Button variant="quiet" small onClick={backToDetails} disabled={busy}>
              {t('Corrigir meus dados')}
            </Button>
          </div>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <form className="form" onSubmit={submitDetails} noValidate>
        <h2 className="form__title">{t('Criar conta')}</h2>
        {invitedBy ? <Notice>{t('Você foi convidado por @{invitedBy}. Ao entrar, você já passa a seguir essa pessoa.', { invitedBy })}</Notice> : null}
        {formError ? <Notice tone="error">{formError}</Notice> : null}
        <Field label={t('E-mail')} type="email" value={email} onChange={setEmail} error={errors['email']} autoComplete="email" inputMode="email" autoFocus />
        <Field label={t('Nome de usuário')} value={username} onChange={(v) => setUsername(v.toLowerCase())} error={errors['username']} hint={t('Letras minúsculas, números, ponto e sublinhado. Não dá para trocar depois.')} prefix="@" autoComplete="username" maxLength={31} />
        <Field label={t('Nome (opcional)')} value={displayName} onChange={setDisplayName} error={errors['displayName']} autoComplete="name" maxLength={60} />
        <PasswordField label={t('Senha')} value={password} onChange={setPassword} error={errors['password']} hint={t('Pelo menos 8 caracteres.')} autoComplete="new-password" />
        <ConsentFields birth={birth} onBirth={setBirth} accepted={accepted} onAccepted={setAccepted} marketing={marketing} onMarketing={setMarketing} errors={errors} />
        <Button type="submit" full loading={busy}>
          {t('Continuar')}
        </Button>
        <p className="form__switch">
          Já tem conta? <Link to="/entrar">{t('Entrar')}</Link>
        </p>
      </form>
      <SocialLogin />
    </AuthLayout>
  );
}

/** Esqueci a senha: 1) e-mail ou @usuário -> 2) código recebido + nova senha. */
export function ForgotPasswordScreen() {
  useTitle(t('Recuperar senha'));
  const { signIn } = useAuthContext();
  const [started, setStarted] = useState<PasswordResetStarted | undefined>();
  const [identifier, setIdentifier] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | undefined>();
  const [info, setInfo] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const now = useNow();
  const redirect = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(redirect.current), []);

  async function request(event?: FormEvent) {
    event?.preventDefault();
    const found = compact({ identifier: loginIdentifierProblem(identifier) });
    setErrors(found);
    setFormError(undefined);
    setInfo(undefined);
    window.clearTimeout(redirect.current);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    try {
      setStarted(await api.requestPasswordReset(identifier.trim()));
      setCode('');
      setPassword('');
    } catch (failure) {
      const error = toApiError(failure);
      setErrors(error.fields);
      setFormError(Object.keys(error.fields).length === 0 ? error.message : undefined);
      // Sem conta com esse dado: mostra o aviso e, depois de 3 s, leva para o login.
      if (error.fields['identifier'] !== undefined && error.code === 'VALIDATION') {
        setFormError(error.message);
        redirect.current = window.setTimeout(() => navigate('/entrar'), 3000);
      }
    } finally {
      setBusy(false);
    }
  }

  async function confirm(event: FormEvent) {
    event.preventDefault();
    const found = compact({ code: codeProblem(code), password: passwordProblem(password) });
    setErrors(found);
    setFormError(undefined);
    setInfo(undefined);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    try {
      signIn(await api.confirmPasswordReset(identifier.trim(), code.trim(), password));
    } catch (failure) {
      const error = toApiError(failure);
      setErrors(error.fields);
      setFormError(Object.keys(error.fields).length === 0 ? error.message : undefined);
      setBusy(false);
    }
  }

  if (started) {
    const wait = secondsUntil(started.resendAvailableAt, now);
    return (
      <AuthLayout>
        <form className="form" onSubmit={confirm} noValidate>
          <BackButton onClick={() => setStarted(undefined)} disabled={busy} />
          <h2 className="form__title">{t('Criar nova senha')}</h2>
          <p className="form__text">
            {t('Enviamos um código de 6 números para o e-mail da conta. Ele vale por {minutes} minutos.', { minutes: started.expiresInMinutes })}
          </p>
          {import.meta.env.DEV ? <Notice tone="info">{t('Ambiente de desenvolvimento: o código não chega por e-mail, aparece no log da API.')}</Notice> : null}
          {info ? <Notice tone="ok">{info}</Notice> : null}
          {formError ? <Notice tone="error">{formError}</Notice> : null}
          <Field label={t('Código')} value={code} onChange={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} error={errors['code']} inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus />
          <PasswordField label={t('Nova senha')} value={password} onChange={setPassword} error={errors['password']} hint={t('Pelo menos 8 caracteres.')} autoComplete="new-password" />
          <Button type="submit" full loading={busy}>
            {t('Salvar e entrar')}
          </Button>
          <div className="form__row">
            <Button
              variant="quiet"
              small
              onClick={async () => {
                await request();
                setInfo(t('Enviamos um novo código. O anterior deixou de valer.'));
              }}
              disabled={busy || wait > 0}
            >
              {wait > 0 ? t('Reenviar código em {wait}', { wait: formatCountdown(wait) }) : t('Reenviar código')}
            </Button>
            <Button variant="quiet" small onClick={() => setStarted(undefined)} disabled={busy}>
              {t('Usar outro e-mail')}
            </Button>
          </div>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <form className="form" onSubmit={request} noValidate>
        <h2 className="form__title">{t('Recuperar senha')}</h2>
        <p className="form__text">{t('Informe seu e-mail ou @usuário. Vamos mandar um código para o e-mail da conta.')}</p>
        {formError ? <Notice tone="error">{formError}</Notice> : null}
        <Field label={t('E-mail ou @usuário')} value={identifier} onChange={setIdentifier} error={errors['identifier']} autoComplete="username" autoFocus />
        <Button type="submit" full loading={busy}>
          {t('Enviar código')}
        </Button>
        <p className="form__switch">
          Lembrou? <Link to="/entrar">{t('Entrar')}</Link>
        </p>
      </form>
    </AuthLayout>
  );
}
