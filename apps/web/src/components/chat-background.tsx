import { useRef, useState } from 'react';
import { Sheet } from './agenda.tsx';
import { Button, GroupAvatar, Notice } from './ui.tsx';
import { resizeChatBackground, setChatBackground, useChatBackground } from '../lib/chat-bg.ts';
import { toApiError } from '../lib/errors.ts';
import { t } from '../lib/i18n/index.ts';

/** Escolher ou tirar a imagem de fundo da conversa. Vale só para você, neste aparelho. */
export function ChatBackgroundSheet({ conversationId, onClose }: { conversationId: string; onClose: () => void }) {
  const current = useChatBackground(conversationId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setProblem(undefined);
    try {
      setChatBackground(conversationId, await resizeChatBackground(file));
      onClose();
    } catch (failure) {
      setProblem(toApiError(failure).message);
      setBusy(false);
    }
    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <Sheet title={t('Imagem de fundo')} onClose={onClose}>
      {problem ? <Notice tone="error">{problem}</Notice> : null}
      <div className="groupedit__photo">
        {current ? <img className="chatbgprev" src={current} alt={t('Fundo atual da conversa')} /> : <GroupAvatar name={t('Fundo')} size={96} imageUrl={null} />}
        <div className="groupedit__actions">
          <span className="btn btn--secondary btn--small filebtn">
            {current ? t('Trocar imagem') : t('Escolher imagem')}
            <input ref={fileRef} type="file" accept="image/*" aria-label={t('Escolher imagem de fundo')} disabled={busy} onChange={(e) => void pick(e.target.files?.[0])} />
          </span>
          {current ? (
            <Button small variant="quiet" onClick={() => { setChatBackground(conversationId, null); onClose(); }}>
              {t('Remover imagem')}
            </Button>
          ) : null}
        </div>
      </div>
    </Sheet>
  );
}
