import { useState } from 'react';
import { Sheet } from './agenda.tsx';
import { BellOffIcon, PinIcon, TrashIcon } from './icons.tsx';
import { Confirm, Notice } from './ui.tsx';
import { api } from '../client.ts';
import { toApiError } from '../lib/errors.ts';
import { t } from '../lib/i18n/index.ts';

/**
 * Fixar no topo da lista e silenciar os avisos de uma conversa. Vale só para você.
 * Com `remove` (na lista de conversas), também apaga a conversa da sua lista (1 a 1) ou sai do grupo.
 */
export function ChatPrefsSheet({ conversationId, title, pinned, muted, onClose, onChanged, remove }: { conversationId: string; title: string; pinned: boolean; muted: boolean; onClose: () => void; onChanged: (prefs: { pinned: boolean; muted: boolean }) => void; remove?: { group: boolean; onRemoved: () => void } }) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();

  async function change(patch: { pinned?: boolean; muted?: boolean }) {
    setBusy(true);
    setProblem(undefined);
    try {
      const next = await api.setChatPrefs(conversationId, patch);
      onChanged(next);
      onClose();
    } catch (failure) {
      setProblem(toApiError(failure).message);
      setBusy(false);
    }
  }

  async function removeIt() {
    if (!remove) return;
    setBusy(true);
    setProblem(undefined);
    try {
      if (remove.group) await api.leaveGroup(conversationId);
      else await api.clearConversation(conversationId);
      remove.onRemoved();
      onClose();
    } catch (failure) {
      setProblem(toApiError(failure).message);
      setBusy(false);
    }
  }

  if (confirming && remove) {
    return (
      <Sheet title={title} onClose={onClose}>
        {problem ? <Notice tone="error">{problem}</Notice> : null}
        <Confirm
          danger
          question={
            remove.group
              ? t('Sair do grupo? Ele some da sua lista e você para de receber as mensagens. Para voltar, alguém do grupo precisa te adicionar.')
              : t('Apagar esta conversa? Ela some da sua lista e as mensagens somem para você; a outra pessoa continua vendo. Se ela escrever de novo, a conversa volta só com as mensagens novas.')
          }
          confirmLabel={remove.group ? t('Sair do grupo') : t('Apagar conversa')}
          busy={busy}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void removeIt()}
        />
      </Sheet>
    );
  }

  return (
    <Sheet title={title} onClose={onClose}>
      {problem ? <Notice tone="error">{problem}</Notice> : null}
      <ul className="sharelist">
        <li>
          <button type="button" className="sharelist__item sharelist__item--icon" disabled={busy} onClick={() => void change({ pinned: !pinned })}>
            <PinIcon />
            <strong>{pinned ? t('Desafixar conversa') : t('Fixar no topo')}</strong>
          </button>
        </li>
        <li>
          <button type="button" className="sharelist__item sharelist__item--icon" disabled={busy} onClick={() => void change({ muted: !muted })}>
            <BellOffIcon />
            <strong>{muted ? t('Reativar avisos') : t('Silenciar avisos')}</strong>
          </button>
        </li>
        {remove ? (
          <li>
            <button type="button" className="sharelist__item sharelist__item--icon sharelist__item--danger" disabled={busy} onClick={() => setConfirming(true)}>
              <TrashIcon />
              <strong>{remove.group ? t('Sair do grupo') : t('Apagar conversa')}</strong>
            </button>
          </li>
        ) : null}
      </ul>
    </Sheet>
  );
}
