import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CheckCircleIcon, CopyIcon, ReplyIcon, TrashIcon } from './icons.tsx';
import { Confirm, Notice } from './ui.tsx';
import { api } from '../client.ts';
import { allDeletable, selectable } from '../lib/chat.ts';
import { REACTIONS } from '../lib/chat-media.ts';
import { toApiError } from '../lib/errors.ts';
import type { ChatMessage, ChatReaction } from '../lib/types.ts';

export { selectable as hasActions };

const BAR_H = 52;
const GAP = 8;
const EDGE = 12;

/**
 * Menu que abre ao segurar a mensagem: a mensagem fica em destaque, a barra de reações logo acima
 * e as opções logo abaixo (reagir, responder, copiar, selecionar, apagar).
 */
export function MessagePopup({ message, conversationId, canSend, onClose, onReply, onSelect, onReacted, onDeleted }: { message: ChatMessage; conversationId: string; canSend: boolean; onClose: () => void; onReply: () => void; onSelect: () => void; onReacted: (reactions: ChatReaction[]) => void; onDeleted: (message: ChatMessage) => void }) {
  const [step, setStep] = useState<'menu' | 'delete'>('menu');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();
  const [copied, setCopied] = useState(false);
  const [pos, setPos] = useState<{ barTop: number; menuTop: number } | undefined>();
  const menuRef = useRef<HTMLDivElement>(null);
  const mine = message.reactions.find((r) => r.mine)?.emoji;
  const canDelete = allDeletable([message]);

  // Trava a rolagem da página enquanto o menu está aberto (senão a mensagem sai de baixo dele).
  useLayoutEffect(() => {
    const y = window.scrollY;
    const body = document.body;
    const before = { position: body.style.position, top: body.style.top, width: body.style.width };
    body.style.position = 'fixed';
    body.style.top = `-${y}px`;
    body.style.width = '100%';
    return () => {
      body.style.position = before.position;
      body.style.top = before.top;
      body.style.width = before.width;
      window.scrollTo(0, y);
    };
  }, []);

  // Destaca a própria mensagem acima do fundo escurecido e mede onde ficam a barra e o menu.
  useLayoutEffect(() => {
    const el = document.getElementById(`msg-${message.id}`);
    el?.classList.add('msg--lifted');
    const place = () => {
      const rect = el?.getBoundingClientRect();
      const menuH = menuRef.current?.offsetHeight ?? 160;
      const top = Math.max(rect?.top ?? window.innerHeight / 2, BAR_H + GAP + EDGE + 56);
      const bottom = Math.min(rect?.bottom ?? window.innerHeight / 2, window.innerHeight - menuH - GAP - EDGE);
      setPos({ barTop: Math.max(EDGE + 56, top - BAR_H - GAP), menuTop: Math.max(bottom + GAP, top) });
    };
    place();
    return () => el?.classList.remove('msg--lifted');
  }, [message.id, step]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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
      window.setTimeout(onClose, 500);
    } catch {
      setProblem('Não consegui copiar. Selecione o texto na mensagem.');
    }
  }

  const side = message.mine ? 'msgpop--mine' : 'msgpop--theirs';
  const style = (top: number | undefined) => (top === undefined ? { visibility: 'hidden' as const } : { top });
  return (
    <div className={`msgpop ${side}`} role="dialog" aria-modal="true" aria-label="Opções da mensagem">
      <div className="msgpop__scrim" onClick={onClose} />
      {canSend && step === 'menu' ? (
        <div className="msgpop__bar" style={style(pos?.barTop)} role="group" aria-label="Reagir">
          {REACTIONS.map((emoji) => (
            <button key={emoji} type="button" className={`msgpop__emoji${mine === emoji ? ' is-on' : ''}`} aria-pressed={mine === emoji} aria-label={`Reagir com ${emoji}`} disabled={busy} onClick={() => void react(emoji)}>
              {emoji}
            </button>
          ))}
        </div>
      ) : null}
      <div ref={menuRef} className="msgpop__menu" style={style(pos?.menuTop)}>
        {problem ? <Notice tone="error">{problem}</Notice> : null}
        {step === 'delete' ? (
          <Confirm danger question="Apagar esta mensagem para todos? Ela some da conversa de todo mundo e não dá para desfazer." confirmLabel="Apagar para todos" busy={busy} onCancel={() => setStep('menu')} onConfirm={() => void remove()} />
        ) : (
          <ul>
            {canSend ? (
              <li>
                <button type="button" className="msgpop__item" onClick={() => { onReply(); onClose(); }}>
                  <span>Responder</span>
                  <ReplyIcon />
                </button>
              </li>
            ) : null}
            {message.kind === 'TEXT' ? (
              <li>
                <button type="button" className="msgpop__item" onClick={() => void copy()}>
                  <span>{copied ? 'Copiado' : 'Copiar texto'}</span>
                  <CopyIcon />
                </button>
              </li>
            ) : null}
            <li>
              <button type="button" className="msgpop__item" onClick={() => { onSelect(); onClose(); }}>
                <span>Selecionar</span>
                <CheckCircleIcon />
              </button>
            </li>
            {canDelete ? (
              <li>
                <button type="button" className="msgpop__item msgpop__item--danger" onClick={() => setStep('delete')}>
                  <span>Apagar para todos</span>
                  <TrashIcon />
                </button>
              </li>
            ) : null}
          </ul>
        )}
      </div>
    </div>
  );
}
