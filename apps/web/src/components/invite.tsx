import { useState } from 'react';
import { useUser } from '../auth.tsx';
import { inviteText, shareableInviteUrl, storeLink, whatsappUrl } from '../lib/invite.ts';
import { Sheet } from './agenda.tsx';
import { Button, Notice } from './ui.tsx';
import { t } from '../lib/i18n/index.ts';

/** Convidar quem ainda não está no AskouT: WhatsApp, compartilhar do aparelho ou copiar o link. */
export function InviteSheet({ onClose }: { onClose: () => void }) {
  const user = useUser();
  const store = storeLink(import.meta.env.VITE_STORE_URL as string | undefined);
  const url = shareableInviteUrl(window.location.origin, user.profile.username, store);
  const text = inviteText(user.profile.displayName);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | undefined>();

  async function shareOrCopy() {
    setMessage(undefined);
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: t('AskouT'), text, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setMessage({ tone: 'ok', text: t('Link copiado. Cole onde quiser.') });
    } catch (failure) {
      if (failure instanceof DOMException && failure.name === 'AbortError') return;
      setMessage({ tone: 'error', text: t('Não foi possível copiar. O link é {url}', { url }) });
    }
  }

  return (
    <Sheet title={t('Convidar amigos')} onClose={onClose}>
      <p className="muted">
        {store
          ? t('Mande o link para a galera baixar o app. Depois, é só se seguirem para virarem amigos.')
          : t('Quem entrar pelo seu link já passa a seguir você. Para virarem amigos, é só você seguir de volta.')}
      </p>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <a className="btn btn--primary btn--full" href={whatsappUrl(text, url)} target="_blank" rel="noopener noreferrer">
        {t('Enviar pelo WhatsApp')}
      </a>
      <Button full variant="secondary" onClick={() => void shareOrCopy()}>
        {typeof navigator.share === 'function' ? t('Compartilhar link') : t('Copiar link')}
      </Button>
    </Sheet>
  );
}
