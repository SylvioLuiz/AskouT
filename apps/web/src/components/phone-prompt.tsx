import { useEffect, useState } from 'react';
import { api } from '../client.ts';
import { useUser } from '../auth.tsx';
import { toApiError } from '../lib/errors.ts';
import { t } from '../lib/i18n/index.ts';
import { shouldShowOnboarding } from '../lib/onboarding.ts';
import { normalizePhone } from '../lib/phone.ts';
import { Sheet } from './agenda.tsx';
import { Button, Field } from './ui.tsx';

/** Espera um pouco depois de abrir, para não chegar junto com os pedidos de localização e de avisos do sistema. */
const PROMPT_DELAY_MS = 6000;

function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Ao abrir o app, pede para quem ainda não tem celular no perfil cadastrar um. Quem decide se aparece é o servidor (conta
 * sem celular, depois do primeiro dia, poucas vezes e com dias de intervalo), então o limite vale em todos os aparelhos.
 * Não aparece na mesma abertura do tutorial inicial.
 */
export function PhonePrompt() {
  const user = useUser();
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (shouldShowOnboarding(storage(), user)) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .phonePrompt()
        .then(({ show }) => {
          if (!show || cancelled) return;
          setOpen(true);
          api.markPhonePrompted().catch(() => undefined);
        })
        .catch(() => undefined);
    }, PROMPT_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // Uma vez por abertura do app (por conta).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);

  if (!open) return null;

  async function save() {
    if (!normalizePhone(phone)) {
      setError(phone.trim() === '' ? t('Informe seu celular') : t('Informe o celular com DDD, ex.: (99) 99999-9999'));
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await api.setPhone(phone);
      setOpen(false);
    } catch (failure) {
      const problem = toApiError(failure);
      setError(problem.fields['phone'] ?? problem.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title={t('Cadastre seu celular')} onClose={() => setOpen(false)}>
      <p className="muted sheet__lead">{t('Assim seus amigos acham você pela agenda do celular. O número não aparece para ninguém.')}</p>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Field
          label={t('Celular')}
          type="tel"
          inputMode="tel"
          value={phone}
          onChange={(value) => {
            setPhone(value);
            setError(undefined);
          }}
          error={error}
          autoComplete="tel"
          maxLength={25}
          placeholder="(99) 99999-9999"
        />
        <div className="sheetactions">
          <Button type="submit" full loading={busy}>
            {t('Salvar')}
          </Button>
          <Button variant="quiet" full onClick={() => setOpen(false)} disabled={busy}>
            {t('Agora não')}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
