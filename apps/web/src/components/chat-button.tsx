import { useState } from 'react';
import { api } from '../client.ts';
import { toApiError } from '../lib/errors.ts';
import { navigate } from '../router.tsx';
import { Button } from './ui.tsx';
import { t } from '../lib/i18n/index.ts';

/** Abre (ou cria) a conversa com um amigo e vai para ela. */
export function ChatButton({ userId, variant = 'secondary', small = false, onError }: { userId: string; variant?: 'primary' | 'secondary' | 'quiet'; small?: boolean; onError?: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  async function open() {
    setBusy(true);
    try {
      const { id } = await api.openConversation(userId);
      navigate(`/conversas/${id}`);
    } catch (failure) {
      onError?.(toApiError(failure).message);
      setBusy(false);
    }
  }
  return (
    <Button variant={variant} small={small} loading={busy} onClick={open}>
      {t('Conversar')}
    </Button>
  );
}
