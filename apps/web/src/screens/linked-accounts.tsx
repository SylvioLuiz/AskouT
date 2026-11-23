import { useState } from 'react';
import type { FormEvent } from 'react';
import { GoogleLogo, SocialButtons } from '../components/social-login.tsx';
import { Button, ErrorState, Loading, Notice, PageHead, PasswordField } from '../components/ui.tsx';
import { api } from '../client.ts';
import { useUser } from '../auth.tsx';
import { useAsync, useTitle } from '../hooks.ts';
import { toApiError } from '../lib/errors.ts';
import { appleLogoUrl, providerLabel } from '../lib/social-login.ts';
import type { LinkedAccounts, SocialProviderId } from '../lib/types.ts';
import { passwordProblem } from '../lib/validation.ts';
import { getLocale, t } from '../lib/i18n/index.ts';

const ORDER: readonly SocialProviderId[] = ['GOOGLE', 'APPLE'];

/**
 * Contas vinculadas, como no Instagram/TikTok: mostra se o Google e a Apple estão ligados ao perfil, deixa ligar
 * (inclusive numa conta criada com e-mail e senha) e desligar. Sem senha, a última forma de entrar só sai depois de criar uma senha.
 */
export function LinkedAccountsScreen() {
  useTitle(t('Contas vinculadas'));
  const user = useUser();
  const data = useAsync(() => Promise.all([api.linkedAccounts(), api.socialProviders()]), []);
  const [linked, setLinked] = useState<LinkedAccounts | undefined>();
  const [confirming, setConfirming] = useState<SocialProviderId | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();

  const current = linked ?? data.data?.[0];
  const configured = new Set((data.data?.[1].items ?? []).map((p) => p.provider));

  async function connect(provider: SocialProviderId, idToken: string) {
    setError(undefined);
    setNotice(undefined);
    setBusy(true);
    try {
      setLinked(await api.linkAccount(provider, idToken));
      setNotice(t('{provider} conectado. Agora você pode entrar com ele.', { provider: providerLabel(provider) }));
    } finally {
      setBusy(false);
    }
  }

  async function unlink(provider: SocialProviderId) {
    setError(undefined);
    setNotice(undefined);
    setBusy(true);
    try {
      setLinked(await api.unlinkAccount(provider));
      setConfirming(undefined);
      setNotice(t('{provider} desvinculado.', { provider: providerLabel(provider) }));
    } catch (failure) {
      setError(toApiError(failure).message);
    } finally {
      setBusy(false);
    }
  }

  const fmt = (iso: string) => new Date(iso).toLocaleDateString(getLocale(), { day: '2-digit', month: '2-digit', year: 'numeric' });

  return (
    <>
      <PageHead title={t('Contas vinculadas')} back="/configuracao" />
      {data.loading && !data.data ? <Loading shape="lines" /> : null}
      {data.error && !data.data ? <ErrorState message={data.error.message} onRetry={data.reload} /> : null}
      {current ? (
        <div className="linked">
          <p className="muted">{t('Entre no AskouT com o Google ou a Apple, sem digitar senha. Só você vê quais contas estão vinculadas.')}</p>
          {notice ? <Notice tone="ok">{notice}</Notice> : null}
          {error ? <Notice tone="error">{error}</Notice> : null}
          <ul className="linked__list">
            {ORDER.filter((p) => configured.has(p) || current.items.some((i) => i.provider === p)).map((provider) => {
              const item = current.items.find((i) => i.provider === provider);
              const isLast = item !== undefined && current.items.length === 1;
              const needsPassword = isLast && !current.hasPassword;
              return (
                <li key={provider} className="linked__row">
                  <div className="linked__head">
                    <span className={`linked__logo linked__logo--${provider.toLowerCase()}`} aria-hidden="true">
                      {provider === 'GOOGLE' ? <GoogleLogo /> : <img src={appleLogoUrl(40)} alt="" width="36" height="36" />}
                    </span>
                    <span className="linked__who">
                      <span className="linked__name">{providerLabel(provider)}</span>
                      <span className="linked__status">{item ? t('Conectado em {date}', { date: fmt(item.linkedAt) }) : t('Não conectado')}</span>
                    </span>
                    {item && confirming !== provider ? (
                      <Button small variant="quiet" onClick={() => setConfirming(provider)} disabled={busy}>
                        {t('Desvincular')}
                      </Button>
                    ) : null}
                  </div>
                  {!item ? <SocialButtons only={[provider]} verb="connect" busy={busy} onToken={connect} /> : null}
                  {item && confirming === provider ? (
                    needsPassword ? (
                      <CreatePassword
                        provider={provider}
                        email={user.email}
                        onCancel={() => setConfirming(undefined)}
                        onCreated={() => {
                          setLinked({ ...current, hasPassword: true });
                          void unlink(provider);
                        }}
                      />
                    ) : (
                      <div className="linked__confirm">
                        <p>
                          {isLast
                            ? t('Depois de desvincular, entre com seu e-mail ou @usuário e a sua senha.')
                            : t('Você não vai mais conseguir entrar com essa conta {provider}.', { provider: providerLabel(provider) })}
                        </p>
                        <div className="linked__actions">
                          <Button small variant="danger" loading={busy} onClick={() => unlink(provider)}>
                            {t('Desvincular {provider}', { provider: providerLabel(provider) })}
                          </Button>
                          <Button small variant="quiet" onClick={() => setConfirming(undefined)} disabled={busy}>
                            {t('Cancelar')}
                          </Button>
                        </div>
                      </div>
                    )
                  ) : null}
                </li>
              );
            })}
          </ul>
          {!current.hasPassword ? <p className="muted">{t('Sua conta foi criada com {provider} e ainda não tem senha.', { provider: providerLabel(current.items[0]?.provider ?? 'GOOGLE') })}</p> : null}
        </div>
      ) : null}
    </>
  );
}

/** Única forma de entrar e sem senha: cria a senha aqui mesmo (sem pedir uma atual) e então desvincula. */
function CreatePassword({ provider, email, onCreated, onCancel }: { provider: SocialProviderId; email: string; onCreated: () => void; onCancel: () => void }) {
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const problems: Record<string, string> = {};
    const p = passwordProblem(next);
    if (p) problems['newPassword'] = p;
    else if (confirm !== next) problems['confirm'] = t('As senhas não são iguais');
    setErrors(problems);
    setError(undefined);
    if (Object.keys(problems).length > 0) return;
    setBusy(true);
    try {
      await api.createPassword(next);
      onCreated();
    } catch (failure) {
      const e = toApiError(failure);
      setErrors(e.fields);
      setError(Object.keys(e.fields).length === 0 ? e.message : undefined);
      setBusy(false);
    }
  }

  return (
    <form className="linked__confirm form form--flat" onSubmit={(e) => void submit(e)} noValidate>
      <Notice>{t('{provider} é a única forma de entrar na sua conta. Para desvincular, crie uma senha: depois você entra com {email} ou seu @usuário e essa senha.', { provider: providerLabel(provider), email })}</Notice>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <PasswordField label={t('Nova senha')} value={next} onChange={setNext} error={errors['newPassword']} hint={t('Use ao menos 8 caracteres')} autoComplete="new-password" />
      <PasswordField label={t('Repita a nova senha')} value={confirm} onChange={setConfirm} error={errors['confirm']} autoComplete="new-password" />
      <Button type="submit" full loading={busy}>
        {t('Criar senha e desvincular')}
      </Button>
      <Button variant="quiet" full onClick={onCancel} disabled={busy}>
        {t('Cancelar')}
      </Button>
    </form>
  );
}
