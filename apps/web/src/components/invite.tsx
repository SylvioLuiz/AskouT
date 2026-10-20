import { useState } from 'react';
import { useUser } from '../auth.tsx';
import { inviteText, inviteUrl, whatsappUrl } from '../lib/invite.ts';
import { Sheet } from './agenda.tsx';
import { Button, Notice } from './ui.tsx';

/** Convidar quem ainda não está no AskouT: WhatsApp, compartilhar do aparelho ou copiar o link. */
export function InviteSheet({ onClose }: { onClose: () => void }) {
  const user = useUser();
  const url = inviteUrl(window.location.origin, user.profile.username);
  const text = inviteText(user.profile.displayName);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | undefined>();

  async function shareOrCopy() {
    setMessage(undefined);
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: 'AskouT', text, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setMessage({ tone: 'ok', text: 'Link copiado. Cole onde quiser.' });
    } catch (failure) {
      if (failure instanceof DOMException && failure.name === 'AbortError') return;
      setMessage({ tone: 'error', text: `Não foi possível copiar. O link é ${url}` });
    }
  }

  return (
    <Sheet title="Convidar amigos" onClose={onClose}>
      <p className="muted">Quem entrar pelo seu link já passa a seguir você. Para virarem amigos, é só você seguir de volta.</p>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <a className="btn btn--primary btn--full" href={whatsappUrl(text, url)} target="_blank" rel="noopener noreferrer">
        Enviar pelo WhatsApp
      </a>
      <Button full variant="secondary" onClick={() => void shareOrCopy()}>
        {typeof navigator.share === 'function' ? 'Compartilhar link' : 'Copiar link'}
      </Button>
    </Sheet>
  );
}
