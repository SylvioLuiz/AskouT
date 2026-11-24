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
export function ChatPrefsSheet({ conversationId, title, pinned, muted, onClose, onChanged, remove }: { conversationId: string; title: string; pinned: boolean; muted: boolean; onClose: () => void; onChanged: (prefs: { pinned: boolean; muted: boolean }) => void; remove?: { group: boolean; community?: boolean; left?: boolean; onRemoved: () => void } }) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  /** Grupo de amigos: sair e já excluir a conversa (senão ela fica na lista só para ler, como no WhatsApp). */
  const [alsoDelete, setAlsoDelete] = useState(false);
  const leftGroup = remove?.group === true && remove.left === true;
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
      if (leftGroup) await api.forgetConversation(conversationId);
      else if (remove.group) await api.leaveGroup(conversationId, remove.community === true && alsoDelete);
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
        {remove.group && remove.community && !leftGroup ? (
          <label className="check">
            <input type="checkbox" checked={alsoDelete} onChange={(e) => setAlsoDelete(e.target.checked)} />
            <span>
              <strong>{t('Excluir a conversa também')}</strong>
              <span className="muted">{t('Sem marcar, a conversa fica na sua lista só para ler, até você excluir.')}</span>
            </span>
          </label>
        ) : null}
        <Confirm
          danger
          question={
            leftGroup
              ? t('Excluir esta conversa? Ela some da sua lista e as mensagens somem para você.')
              : remove.group && remove.community
                ? t('Sair do grupo? Você para de receber as mensagens e os eventos novos. Para voltar, só com um novo convite.')
                : remove.group
                  ? t('Sair do grupo? Ele some da sua lista e você para de receber as mensagens. Para voltar, alguém do grupo precisa te adicionar.')
                  : t('Apagar esta conversa? Ela some da sua lista e as mensagens somem para você; a outra pessoa continua vendo. Se ela escrever de novo, a conversa volta só com as mensagens novas.')
          }
          confirmLabel={leftGroup ? t('Excluir conversa') : remove.group ? (remove.community && alsoDelete ? t('Sair e excluir') : t('Sair do grupo')) : t('Apagar conversa')}
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
              <strong>{leftGroup ? t('Excluir conversa') : remove.group ? t('Sair do grupo') : t('Apagar conversa')}</strong>
            </button>
          </li>
        ) : null}
      </ul>
    </Sheet>
  );
}
