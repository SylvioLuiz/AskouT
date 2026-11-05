import { useState } from 'react';
import { api } from '../client.ts';
import { toApiError } from '../lib/errors.ts';
import { navigate } from '../router.tsx';
import { Button } from './ui.tsx';
import { t } from '../lib/i18n/index.ts';
import { ChatIcon } from './icons.tsx';

/** Abre (ou cria) a conversa com um amigo e vai para ela. */
export function ChatButton({ userId, variant = 'secondary', small = false, label, icon = false, onError }: { userId: string; variant?: 'primary' | 'secondary' | 'quiet'; small?: boolean; label?: string; /** Só o ícone de conversa (com o texto como nome acessível). */ icon?: boolean; onError?: (message: string) => void }) {
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
  if (icon)
    return (
      <button type="button" className="iconbtn iconbtn--chat" aria-label={label ?? t('Conversar')} title={label ?? t('Conversar')} disabled={busy} onClick={open}>
        <ChatIcon />
      </button>
    );
  return (
    <Button variant={variant} small={small} loading={busy} onClick={open}>
      {label ?? t('Conversar')}
    </Button>
  );
}
