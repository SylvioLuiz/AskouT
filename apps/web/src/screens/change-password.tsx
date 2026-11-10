import { useState } from 'react';
import type { FormEvent } from 'react';
import { Button, ErrorState, Loading, Notice, PageHead, PasswordField } from '../components/ui.tsx';
import { api } from '../client.ts';
import { useAsync, useTitle } from '../hooks.ts';
import { toApiError } from '../lib/errors.ts';
import { passwordProblem } from '../lib/validation.ts';
import { navigate } from '../router.tsx';
import { t } from '../lib/i18n/index.ts';

/** Trocar a senha de quem já está logado. Pede a atual; quem entra só com Google ou Apple não tem senha própria. */
export function ChangePasswordScreen() {
  useTitle(t('Trocar senha'));
  const status = useAsync(() => api.passwordStatus(), []);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    setDone(false);
    const problems: Record<string, string> = {};
    if (current === '') problems['currentPassword'] = t('Digite a sua senha atual');
    const nextProblem = passwordProblem(next) ?? (next === current && next !== '' ? t('A nova senha precisa ser diferente da atual') : undefined);
    if (nextProblem) problems['newPassword'] = nextProblem;
    if (!nextProblem && confirm !== next) problems['confirm'] = t('As senhas não são iguais');
    setErrors(problems);
    if (Object.keys(problems).length > 0) return;

    setBusy(true);
    try {
      await api.changePassword({ currentPassword: current, newPassword: next });
      setCurrent('');
      setNext('');
      setConfirm('');
      setDone(true);
    } catch (failure) {
      const e = toApiError(failure);
      setErrors(e.fields);
      setError(Object.keys(e.fields).length === 0 ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead title={t('Trocar senha')} back="/configuracao" />
      {status.loading && !status.data ? <Loading /> : null}
      {status.error && !status.data ? <ErrorState message={status.error.message} onRetry={status.reload} /> : null}
      {status.data && !status.data.hasPassword ? (
        <Notice>{t('Sua conta entra com Google ou Apple e não tem senha própria no AskouT. Para mudar a senha, troque-a na sua conta Google ou Apple.')}</Notice>
      ) : null}
      {status.data?.hasPassword ? (
        <form className="form" onSubmit={(e) => void submit(e)} noValidate>
          {done ? <Notice tone="ok">{t('Senha trocada. Use a nova senha da próxima vez que entrar.')}</Notice> : null}
          {error ? <Notice tone="error">{error}</Notice> : null}
          <PasswordField label={t('Senha atual')} value={current} onChange={setCurrent} error={errors['currentPassword']} autoComplete="current-password" />
          <PasswordField label={t('Nova senha')} value={next} onChange={setNext} error={errors['newPassword']} hint={t('Use ao menos 8 caracteres')} autoComplete="new-password" />
          <PasswordField label={t('Repita a nova senha')} value={confirm} onChange={setConfirm} error={errors['confirm']} autoComplete="new-password" />
          <Button type="submit" full loading={busy}>
            {t('Trocar senha')}
          </Button>
          <Button variant="quiet" full onClick={() => navigate('/configuracao')} disabled={busy}>
            {t('Voltar')}
          </Button>
        </form>
      ) : null}
    </>
  );
}
