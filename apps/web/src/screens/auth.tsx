import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { AuthLayout } from '../components/AuthLayout.tsx';
import { SocialLogin } from '../components/social-login.tsx';
import { Button, Field, Notice, PasswordField } from '../components/ui.tsx';
import { api } from '../client.ts';
import { useAuthContext } from '../auth.tsx';
import { useTitle } from '../hooks.ts';
import { toApiError } from '../lib/errors.ts';
import { formatCountdown, secondsUntil } from '../lib/format.ts';
import type { PasswordResetStarted, SignupStarted } from '../lib/types.ts';
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
import { Link, useSearch } from '../router.tsx';

function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const handle = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(handle);
  }, [intervalMs]);
  return now;
}

export function LoginScreen() {
  useTitle('Entrar');
  const { signIn } = useAuthContext();
  const expired = useSearch().get('expirou') === '1';
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found = compact({
      identifier: loginIdentifierProblem(identifier),
      password: password === '' ? 'Informe sua senha' : undefined,
    });
    setErrors(found);
    setFormError(undefined);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    try {
      signIn(await api.login(identifier.trim(), password));
    } catch (failure) {
      const error = toApiError(failure);
      setErrors(error.fields);
      setFormError(Object.keys(error.fields).length === 0 ? error.message : undefined);
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <form className="form" onSubmit={submit} noValidate>
        <h2 className="form__title">Entrar</h2>
        {expired ? <Notice tone="info">Sua sessão expirou. Entre de novo para continuar.</Notice> : null}
        {formError ? <Notice tone="error">{formError}</Notice> : null}
        <Field label="E-mail ou @usuário" value={identifier} onChange={setIdentifier} error={errors['identifier']} autoComplete="username" autoFocus />
        <PasswordField label="Senha" value={password} onChange={setPassword} error={errors['password']} autoComplete="current-password" />
        <Button type="submit" full loading={busy}>
          Entrar
        </Button>
        <p className="form__switch">
          <Link to="/esqueci-senha">Esqueci minha senha</Link>
        </p>
        <p className="form__switch">
          Ainda não tem conta? <Link to="/cadastro">Criar conta</Link>
        </p>
      </form>
      <SocialLogin />
    </AuthLayout>
  );
}

export function SignupScreen() {
  useTitle('Criar conta');
  const { signIn } = useAuthContext();
  const [started, setStarted] = useState<SignupStarted | undefined>();

  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
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
      setInfo('Enviamos um novo código. O anterior deixou de valer.');
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
          <h2 className="form__title">Confirme seu e-mail</h2>
          <p className="form__text">
            Enviamos um código de 6 números para <strong>{started.email}</strong>. Ele vale por 10 minutos.
          </p>
          {import.meta.env.DEV ? (
            <Notice tone="info">Ambiente de desenvolvimento: o código não chega por e-mail, aparece no log da API.</Notice>
          ) : null}
          {info ? <Notice tone="ok">{info}</Notice> : null}
          {formError ? <Notice tone="error">{formError}</Notice> : null}
          <Field label="Código" value={code} onChange={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} error={errors['code']} inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus />
          <Button type="submit" full loading={busy}>
            Confirmar e entrar
          </Button>
          <div className="form__row">
            <Button variant="quiet" small onClick={resend} disabled={busy || wait > 0}>
              {wait > 0 ? `Reenviar código em ${formatCountdown(wait)}` : 'Reenviar código'}
            </Button>
            <Button variant="quiet" small onClick={backToDetails} disabled={busy}>
              Corrigir meus dados
            </Button>
          </div>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <form className="form" onSubmit={submitDetails} noValidate>
        <h2 className="form__title">Criar conta</h2>
        {formError ? <Notice tone="error">{formError}</Notice> : null}
        <Field label="E-mail" type="email" value={email} onChange={setEmail} error={errors['email']} autoComplete="email" inputMode="email" autoFocus />
        <Field label="Nome de usuário" value={username} onChange={(v) => setUsername(v.toLowerCase())} error={errors['username']} hint="Letras minúsculas, números, ponto e sublinhado. Não dá para trocar depois." prefix="@" autoComplete="username" maxLength={31} />
        <Field label="Nome (opcional)" value={displayName} onChange={setDisplayName} error={errors['displayName']} autoComplete="name" maxLength={60} />
        <PasswordField label="Senha" value={password} onChange={setPassword} error={errors['password']} hint="Pelo menos 8 caracteres." autoComplete="new-password" />
        <Button type="submit" full loading={busy}>
          Continuar
        </Button>
        <p className="form__switch">
          Já tem conta? <Link to="/entrar">Entrar</Link>
        </p>
      </form>
      <SocialLogin />
    </AuthLayout>
  );
}

/** Esqueci a senha: 1) e-mail ou @usuário -> 2) código recebido + nova senha. */
export function ForgotPasswordScreen() {
  useTitle('Recuperar senha');
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

  async function request(event?: FormEvent) {
    event?.preventDefault();
    const found = compact({ identifier: loginIdentifierProblem(identifier) });
    setErrors(found);
    setFormError(undefined);
    setInfo(undefined);
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
          <h2 className="form__title">Criar nova senha</h2>
          <p className="form__text">
            Se existir uma conta com esse dado, enviamos um código de 6 números para o e-mail dela. Ele vale por {started.expiresInMinutes} minutos.
          </p>
          {import.meta.env.DEV ? <Notice tone="info">Ambiente de desenvolvimento: o código não chega por e-mail, aparece no log da API.</Notice> : null}
          {info ? <Notice tone="ok">{info}</Notice> : null}
          {formError ? <Notice tone="error">{formError}</Notice> : null}
          <Field label="Código" value={code} onChange={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} error={errors['code']} inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus />
          <PasswordField label="Nova senha" value={password} onChange={setPassword} error={errors['password']} hint="Pelo menos 8 caracteres." autoComplete="new-password" />
          <Button type="submit" full loading={busy}>
            Salvar e entrar
          </Button>
          <div className="form__row">
            <Button
              variant="quiet"
              small
              onClick={async () => {
                await request();
                setInfo('Se a conta existir, enviamos um novo código. O anterior deixou de valer.');
              }}
              disabled={busy || wait > 0}
            >
              {wait > 0 ? `Reenviar código em ${formatCountdown(wait)}` : 'Reenviar código'}
            </Button>
            <Button variant="quiet" small onClick={() => setStarted(undefined)} disabled={busy}>
              Usar outro e-mail
            </Button>
          </div>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <form className="form" onSubmit={request} noValidate>
        <h2 className="form__title">Recuperar senha</h2>
        <p className="form__text">Informe seu e-mail ou @usuário. Vamos mandar um código para o e-mail da conta.</p>
        {formError ? <Notice tone="error">{formError}</Notice> : null}
        <Field label="E-mail ou @usuário" value={identifier} onChange={setIdentifier} error={errors['identifier']} autoComplete="username" autoFocus />
        <Button type="submit" full loading={busy}>
          Enviar código
        </Button>
        <p className="form__switch">
          Lembrou? <Link to="/entrar">Entrar</Link>
        </p>
      </form>
    </AuthLayout>
  );
}
