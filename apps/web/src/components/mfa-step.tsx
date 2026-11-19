import { useState } from 'react';
import type { FormEvent } from 'react';
import { AuthLayout } from './AuthLayout.tsx';
import { CodeBoxes } from './code-boxes.tsx';
import { Button, Field, Notice } from './ui.tsx';
import { ChevronLeftIcon } from './icons.tsx';
import { api } from '../client.ts';
import { toApiError } from '../lib/errors.ts';
import type { AuthResult, MfaChallenge } from '../lib/types.ts';
import { t } from '../lib/i18n/index.ts';

/**
 * Segunda etapa do login (por e-mail ou por celular): código de 6 números do app autenticador em caixinhas,
 * que confirma sozinho ao completar, ou um código de recuperação. `subtitle` mostra para qual conta é (ex.: o celular).
 */
export function MfaStep({ challenge, onDone, onCancel, subtitle, backLabel }: { challenge: MfaChallenge; onDone: (result: AuthResult) => void; onCancel: () => void; subtitle?: string; backLabel?: string }) {
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function verify(value: string) {
    if (busy) return;
    if (value.trim() === '' || (!recovery && value.length < 6)) {
      setError(recovery ? t('Digite o código') : t('Digite os 6 números'));
      return;
    }
    setError(undefined);
    setBusy(true);
    try {
      onDone(await api.mfaVerify(challenge.mfaToken, value.trim()));
    } catch (failure) {
      const e = toApiError(failure);
      // 401: o comprovante expirou (vale poucos minutos); precisa começar o login de novo.
      if (e.code === 'UNAUTHORIZED') {
        onCancel();
        return;
      }
      setError(e.fields['code'] ?? e.message);
      if (!recovery) setCode('');
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void verify(code);
  }

  function toggleRecovery() {
    setRecovery((r) => !r);
    setCode('');
    setError(undefined);
  }

  return (
    <AuthLayout>
      <form className="form" onSubmit={submit} noValidate>
        <button type="button" className="pagehead__back form__back" aria-label={backLabel ?? t('Voltar')} onClick={onCancel} disabled={busy}>
          <ChevronLeftIcon />
        </button>
        <h2 className="form__title">{t('Verificação em duas etapas')}</h2>
        {subtitle ? <p className="form__text">{subtitle}</p> : null}
        {recovery ? (
          <>
            <Notice>{t('Digite um dos códigos de recuperação que você guardou ao ativar a verificação. Cada um vale uma vez.')}</Notice>
            <Field label={t('Código de recuperação')} value={code} onChange={setCode} error={error} autoComplete="off" maxLength={20} autoFocus />
          </>
        ) : (
          <>
            <p className="form__text">{t('Abra o app autenticador e digite o código de 6 números.')}</p>
            <CodeBoxes value={code} onChange={setCode} onComplete={(v) => void verify(v)} disabled={busy} error={error} autoFocus />
          </>
        )}
        <Button type="submit" full loading={busy}>
          {t('Confirmar')}
        </Button>
        <div className="form__row">
          <Button variant="quiet" small onClick={toggleRecovery} disabled={busy}>
            {recovery ? t('Usar o app autenticador') : t('Usar código de recuperação')}
          </Button>
          <Button variant="quiet" small onClick={onCancel} disabled={busy}>
            {backLabel ?? t('Voltar')}
          </Button>
        </div>
      </form>
    </AuthLayout>
  );
}
