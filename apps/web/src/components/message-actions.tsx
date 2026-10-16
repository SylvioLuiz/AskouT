import { useState } from 'react';
import { Sheet } from './agenda.tsx';
import { CopyIcon, ReplyIcon, TrashIcon } from './icons.tsx';
import { Confirm, Notice } from './ui.tsx';
import { api } from '../client.ts';
import { REACTIONS } from '../lib/chat-media.ts';
import { toApiError } from '../lib/errors.ts';
import type { ChatMessage, ChatReaction } from '../lib/types.ts';

/** Só estes tipos podem ser apagados por quem enviou. */
export const DELETABLE_KINDS: readonly ChatMessage['kind'][] = ['TEXT', 'AUDIO', 'IMAGE', 'VIDEO', 'EVENT'];

/** Mensagens sem opções: avisos do sistema e as já apagadas. */
export function hasActions(m: ChatMessage): boolean {
  return m.kind !== 'SYSTEM' && !m.deleted;
}

/** Folha com as opções da mensagem: reagir, responder, copiar e apagar (as suas). */
export function MessageActionsSheet({ message, conversationId, canSend, onClose, onReply, onReacted, onDeleted }: { message: ChatMessage; conversationId: string; canSend: boolean; onClose: () => void; onReply: () => void; onReacted: (reactions: ChatReaction[]) => void; onDeleted: (message: ChatMessage) => void }) {
  const [step, setStep] = useState<'menu' | 'delete'>('menu');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();
  const [copied, setCopied] = useState(false);
  const mine = message.reactions.find((r) => r.mine)?.emoji;
  const canDelete = message.mine && DELETABLE_KINDS.includes(message.kind);

  async function react(emoji: string) {
    setBusy(true);
    setProblem(undefined);
    try {
      const result = await api.reactMessage(conversationId, message.id, emoji);
      onReacted(result.reactions);
      onClose();
    } catch (failure) {
      setProblem(toApiError(failure).message);
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setProblem(undefined);
    try {
      onDeleted(await api.deleteMessage(conversationId, message.id));
      onClose();
    } catch (failure) {
      setProblem(toApiError(failure).message);
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(message.body);
      setCopied(true);
      window.setTimeout(onClose, 600);
    } catch {
      setProblem('Não consegui copiar. Selecione o texto na mensagem.');
    }
  }

  return (
    <Sheet title="Mensagem" onClose={onClose}>
      {problem ? <Notice tone="error">{problem}</Notice> : null}
      {step === 'delete' ? (
        <Confirm danger question="Apagar esta mensagem para todos? Ela some da conversa de todo mundo e não dá para desfazer." confirmLabel="Apagar para todos" busy={busy} onCancel={() => setStep('menu')} onConfirm={() => void remove()} />
      ) : (
        <>
          {canSend ? (
            <div className="reactpick" role="group" aria-label="Reagir">
              {REACTIONS.map((emoji) => (
                <button key={emoji} type="button" className={`reactpick__btn${mine === emoji ? ' is-on' : ''}`} aria-pressed={mine === emoji} aria-label={`Reagir com ${emoji}`} disabled={busy} onClick={() => void react(emoji)}>
                  {emoji}
                </button>
              ))}
            </div>
          ) : null}
          <ul className="sharelist">
            {canSend ? (
              <li>
                <button type="button" className="sharelist__item sharelist__item--icon" onClick={() => { onReply(); onClose(); }}>
                  <ReplyIcon />
                  <strong>Responder</strong>
                </button>
              </li>
            ) : null}
            {message.kind === 'TEXT' ? (
              <li>
                <button type="button" className="sharelist__item sharelist__item--icon" onClick={() => void copy()}>
                  <CopyIcon />
                  <strong>{copied ? 'Copiado' : 'Copiar texto'}</strong>
                </button>
              </li>
            ) : null}
            {canDelete ? (
              <li>
                <button type="button" className="sharelist__item sharelist__item--icon sharelist__item--danger" onClick={() => setStep('delete')}>
                  <TrashIcon />
                  <strong>Apagar para todos</strong>
                </button>
              </li>
            ) : null}
          </ul>
        </>
      )}
    </Sheet>
  );
}
