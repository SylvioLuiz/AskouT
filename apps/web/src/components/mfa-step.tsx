import { useState } from 'react';
import type { FormEvent } from 'react';
import { AuthLayout } from './AuthLayout.tsx';
import { Button, Field, Notice } from './ui.tsx';
import { api } from '../client.ts';
import { toApiError } from '../lib/errors.ts';
import type { AuthResult, MfaChallenge } from '../lib/types.ts';
import { t } from '../lib/i18n/index.ts';

/** Segunda etapa do login: código de 6 dígitos do app autenticador, ou um código de recuperação. */
export function MfaStep({ challenge, onDone, onCancel }: { challenge: MfaChallenge; onDone: (result: AuthResult) => void; onCancel: () => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (code.trim() === '') {
      setError(t('Digite o código'));
      return;
    }
    setError(undefined);
    setBusy(true);
    try {
      onDone(await api.mfaVerify(challenge.mfaToken, code.trim()));
    } catch (failure) {
      const e = toApiError(failure);
      // 401: o comprovante expirou (vale poucos minutos); precisa entrar de novo com a senha.
      if (e.code === 'UNAUTHORIZED') {
        onCancel();
        return;
      }
      setError(e.fields['code'] ?? e.message);
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <form className="form form--flat" onSubmit={(e) => void submit(e)} noValidate>
        <h3 className="form__title">{t('Verificação em duas etapas')}</h3>
        <Notice>{t('Abra o app autenticador e digite o código de 6 dígitos. Sem o celular, use um dos códigos de recuperação.')}</Notice>
        <Field label={t('Código')} value={code} onChange={setCode} error={error} inputMode="numeric" autoComplete="one-time-code" maxLength={12} autoFocus />
        <Button type="submit" full loading={busy}>
          {t('Confirmar')}
        </Button>
        <Button variant="quiet" full onClick={onCancel} disabled={busy}>
          {t('Voltar')}
        </Button>
      </form>
    </AuthLayout>
  );
}
