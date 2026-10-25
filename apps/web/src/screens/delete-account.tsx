import { useState } from 'react';
import type { FormEvent } from 'react';
import { Button, Field, Notice, PageHead, PasswordField } from '../components/ui.tsx';
import { api } from '../client.ts';
import { useAuthContext, useUser } from '../auth.tsx';
import { useTitle } from '../hooks.ts';
import { usernameMatches } from '../lib/account.ts';
import { toApiError } from '../lib/errors.ts';
import { navigate } from '../router.tsx';
import { t } from '../lib/i18n/index.ts';

/** Apagar a conta de vez. Pede o @usuário e a senha; quem entra com Google ou Apple não tem senha própria. */
export function DeleteAccountScreen() {
  useTitle(t('Apagar conta'));
  const user = useUser();
  const { signOut } = useAuthContext();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    if (!usernameMatches(username, user.profile.username)) {
      setErrors({ username: t('Digite o seu @usuário exatamente como ele aparece') });
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await api.deleteMyAccount({ username, ...(password === '' ? {} : { password }) });
      signOut();
      navigate('/entrar', { replace: true });
    } catch (failure) {
      const e = toApiError(failure);
      setErrors(e.fields);
      setError(Object.keys(e.fields).length === 0 ? e.message : undefined);
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead title={t('Apagar minha conta')} back="/privacidade" />
      <Notice tone="error">{t('Isso não tem volta. Antes, você pode baixar uma cópia dos seus dados em Privacidade.')}</Notice>
      <div className="legal-list">
        <p>{t('O que acontece quando você apaga:')}</p>
        <ul>
          <li>{t('Seu perfil, posts, comentários, curtidas, agenda, Flash, avisos e histórico de uso são apagados.')}</li>
          <li>{t('Você deixa de seguir e de ser seguido por todo mundo.')}</li>
          <li>{t('Suas mensagens são apagadas das conversas, inclusive dos grupos.')}</li>
          <li>{t('Encontros que você organizou são cancelados e removidos. Grupos de que você é dono passam para o membro mais antigo; se não houver outros, o grupo some.')}</li>
          <li>{t('Locais que você administra continuam no AskouT, mas sem dono.')}</li>
          <li>{t('O seu e-mail e o seu @usuário ficam livres para uso novamente.')}</li>
        </ul>
      </div>
      <form className="form" onSubmit={(e) => void submit(e)} noValidate>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Field label={t('Digite @{username} para confirmar', { username: user.profile.username })} value={username} onChange={setUsername} error={errors['username']} autoComplete="off" />
        <PasswordField label={t('Senha')} value={password} onChange={setPassword} error={errors['password']} hint={t('Se você entra com Google ou Apple, deixe em branco.')} autoComplete="current-password" />
        <Button type="submit" variant="danger" full loading={busy}>
          {t('Apagar minha conta para sempre')}
        </Button>
        <Button variant="quiet" full onClick={() => navigate('/privacidade')} disabled={busy}>
          {t('Cancelar')}
        </Button>
      </form>
    </>
  );
}
