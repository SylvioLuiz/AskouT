import { useState } from 'react';
import type { FormEvent } from 'react';
import { Button, ErrorState, Field, Loading, Notice, PageHead } from '../components/ui.tsx';
import { api } from '../client.ts';
import { useAsync, useTitle } from '../hooks.ts';
import { toApiError } from '../lib/errors.ts';
import type { MfaSetup } from '../lib/types.ts';
import { t } from '../lib/i18n/index.ts';

/** Verificação em duas etapas por app autenticador (Google Authenticator, Authy, 1Password...). Grátis e opcional. */
export function MfaSettingsScreen() {
  useTitle(t('Verificação em duas etapas'));
  const status = useAsync(() => api.mfaStatus(), []);
  const [setup, setSetup] = useState<MfaSetup | undefined>();
  const [codes, setCodes] = useState<string[] | undefined>();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>) {
    setError(undefined);
    setBusy(true);
    try {
      await action();
    } catch (failure) {
      const e = toApiError(failure);
      setError(e.fields['code'] ?? e.message);
    } finally {
      setBusy(false);
    }
  }

  const start = () =>
    run(async () => {
      setSetup(await api.mfaSetup());
      setCode('');
    });
  const enable = (event: FormEvent) => {
    event.preventDefault();
    return run(async () => {
      setCodes((await api.mfaEnable(code.trim())).recoveryCodes);
      setSetup(undefined);
      setCode('');
      status.reload();
    });
  };
  const disable = (event: FormEvent) => {
    event.preventDefault();
    return run(async () => {
      await api.mfaDisable(code.trim());
      setCode('');
      setCodes(undefined);
      status.reload();
    });
  };
  const regenerate = () =>
    run(async () => {
      setCodes((await api.mfaRecoveryCodes(code.trim())).recoveryCodes);
      setCode('');
      status.reload();
    });

  return (
    <>
      <PageHead title={t('Verificação em duas etapas')} back="/configuracao" />
      {status.loading && !status.data ? <Loading /> : null}
      {status.error && !status.data ? <ErrorState message={status.error.message} onRetry={status.reload} /> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      {codes ? (
        <div className="form">
          <Notice tone="ok">{t('Guarde estes códigos de recuperação em um lugar seguro: cada um vale uma vez e eles não aparecem de novo.')}</Notice>
          <ul className="menulist" aria-label={t('Códigos de recuperação')}>
            {codes.map((c) => (
              <li key={c} style={{ fontFamily: 'monospace', padding: '6px 16px' }}>
                {c}
              </li>
            ))}
          </ul>
          <Button full onClick={() => void navigator.clipboard?.writeText(codes.join('\n'))}>
            {t('Copiar códigos')}
          </Button>
          <Button variant="quiet" full onClick={() => setCodes(undefined)}>
            {t('Já guardei')}
          </Button>
        </div>
      ) : null}

      {!codes && status.data && !status.data.enabled && !setup ? (
        <div className="form">
          <p className="muted">{t('Além da senha, o login passa a pedir um código de 6 dígitos de um app autenticador no seu celular. É grátis e protege a conta mesmo se a senha vazar.')}</p>
          <Button full loading={busy} onClick={() => void start()}>
            {t('Ativar')}
          </Button>
        </div>
      ) : null}

      {!codes && setup ? (
        <form className="form" onSubmit={(e) => void enable(e)} noValidate>
          <p className="muted">{t('Abra o app autenticador, adicione uma conta nova e digite a chave abaixo (ou toque no botão, no celular). Depois digite o código de 6 dígitos que o app mostrar.')}</p>
          <Field label={t('Chave')} value={setup.secret} onChange={() => undefined} />
          <a className="btn btn--secondary btn--full" href={setup.otpauthUrl}>
            {t('Abrir no app autenticador')}
          </a>
          <Field label={t('Código de 6 dígitos')} value={code} onChange={setCode} inputMode="numeric" autoComplete="one-time-code" maxLength={7} />
          <Button type="submit" full loading={busy}>
            {t('Confirmar e ligar')}
          </Button>
          <Button variant="quiet" full onClick={() => setSetup(undefined)} disabled={busy}>
            {t('Cancelar')}
          </Button>
        </form>
      ) : null}

      {!codes && status.data?.enabled ? (
        <form className="form" onSubmit={(e) => void disable(e)} noValidate>
          <Notice tone="ok">{t('Ligada. Códigos de recuperação restantes: {n}', { n: status.data.recoveryCodesLeft })}</Notice>
          <Field label={t('Código do app (ou de recuperação)')} value={code} onChange={setCode} inputMode="numeric" autoComplete="one-time-code" maxLength={12} />
          <Button type="submit" variant="danger" full loading={busy}>
            {t('Desligar')}
          </Button>
          <Button variant="secondary" full onClick={() => void regenerate()} disabled={busy}>
            {t('Gerar novos códigos de recuperação')}
          </Button>
        </form>
      ) : null}
    </>
  );
}
