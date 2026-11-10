import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CheckCircleIcon, CopyIcon, PlusIcon, ReplyIcon, TrashIcon } from './icons.tsx';
import { Sheet } from './agenda.tsx';
import { Confirm, Notice } from './ui.tsx';
import { api } from '../client.ts';
import { allDeletable, selectable } from '../lib/chat.ts';
import { MORE_EMOJIS, REACTIONS, firstEmoji } from '../lib/chat-media.ts';
import { toApiError } from '../lib/errors.ts';
import type { ChatMessage, ChatReaction } from '../lib/types.ts';
import { t } from '../lib/i18n/index.ts';

export { selectable as hasActions };

const BAR_H = 52;
const GAP = 8;
const EDGE = 12;

/**
 * Menu que abre ao segurar a mensagem: a mensagem fica em destaque, a barra de reações logo acima
 * e as opções logo abaixo (reagir, responder, copiar, selecionar, apagar).
 */
export function MessagePopup({ message, conversationId, canSend, onClose, onReply, onSelect, onReacted, onDeleted }: { message: ChatMessage; conversationId: string; canSend: boolean; onClose: () => void; onReply: () => void; onSelect: () => void; onReacted: (reactions: ChatReaction[]) => void; onDeleted: (message: ChatMessage) => void }) {
  const [step, setStep] = useState<'menu' | 'delete' | 'emoji'>('menu');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();
  const [copied, setCopied] = useState(false);
  const [pos, setPos] = useState<{ barTop: number; menuTop: number } | undefined>();
  const menuRef = useRef<HTMLDivElement>(null);
  const mine = message.reactions.find((r) => r.mine)?.emoji;
  const canDelete = allDeletable([message]);

  // Trava a rolagem da página enquanto o menu está aberto (senão a mensagem sai de baixo dele).
  useLayoutEffect(() => {
    window.getSelection()?.removeAllRanges(); // tira qualquer texto que o toque longo tenha selecionado
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
      setProblem(t('Não consegui copiar. Selecione o texto na mensagem.'));
    }
  }

  const side = message.mine ? 'msgpop--mine' : 'msgpop--theirs';
  const style = (top: number | undefined) => (top === undefined ? { visibility: 'hidden' as const } : { top });
  return (
    <div className={`msgpop ${side}`} role="dialog" aria-modal="true" aria-label={t('Opções da mensagem')}>
      <div className="msgpop__scrim" onClick={onClose} />
      {canSend && step === 'menu' ? (
        <div className="msgpop__bar" style={style(pos?.barTop)} role="group" aria-label={t('Reagir')}>
          {REACTIONS.map((emoji) => (
            <button key={emoji} type="button" className={`msgpop__emoji${mine === emoji ? ' is-on' : ''}`} aria-pressed={mine === emoji} aria-label={t('Reagir com {emoji}', { emoji })} disabled={busy} onClick={() => void react(emoji)}>
              {emoji}
            </button>
          ))}
          {mine && !(REACTIONS as readonly string[]).includes(mine) ? (
            <button type="button" className="msgpop__emoji is-on" aria-pressed="true" aria-label={t('Tirar reação {emoji}', { emoji: mine })} disabled={busy} onClick={() => void react(mine)}>
              {mine}
            </button>
          ) : (
            <button type="button" className="msgpop__emoji msgpop__emoji--more" aria-label={t('Mais emojis')} disabled={busy} onClick={() => setStep('emoji')}>
              <PlusIcon />
            </button>
          )}
        </div>
      ) : null}
      <div ref={menuRef} className="msgpop__menu" style={style(pos?.menuTop)}>
        {problem ? <Notice tone="error">{problem}</Notice> : null}
        {step === 'emoji' ? (
          <div className="emojipick">
            <form
              className="emojipick__type"
              onSubmit={(e) => {
                e.preventDefault();
                const emoji = firstEmoji(typed);
                if (emoji) void react(emoji);
                else setProblem(t('Digite um emoji.'));
              }}
            >
              <label className="visually-hidden" htmlFor="emoji-typed">
                {t('Digite qualquer emoji')}
              </label>
              <input
                id="emoji-typed"
                className="emojipick__input"
                value={typed}
                placeholder={t('Ou digite qualquer emoji')}
                autoComplete="off"
                enterKeyHint="send"
                onChange={(e) => {
                  setTyped(e.target.value);
                  const emoji = firstEmoji(e.target.value);
                  if (emoji) void react(emoji);
                }}
              />
            </form>
            <div className="emojipick__grid" role="group" aria-label={t('Escolha um emoji')}>
              {MORE_EMOJIS.map((emoji) => (
                <button key={emoji} type="button" className={`emojipick__btn${mine === emoji ? ' is-on' : ''}`} aria-label={t('Reagir com {emoji}', { emoji })} disabled={busy} onClick={() => void react(emoji)}>
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        ) : step === 'delete' ? (
          <Confirm danger question={t('Apagar esta mensagem para todos? Ela some da conversa de todo mundo e não dá para desfazer.')} confirmLabel={t('Apagar para todos')} busy={busy} onCancel={() => setStep('menu')} onConfirm={() => void remove()} />
        ) : (
          <ul>
            {canSend ? (
              <li>
                <button type="button" className="msgpop__item" onClick={() => { onReply(); onClose(); }}>
                  <span>{t('Responder')}</span>
                  <ReplyIcon />
                </button>
              </li>
            ) : null}
            {message.kind === 'TEXT' && !message.gif ? (
              <li>
                <button type="button" className="msgpop__item" onClick={() => void copy()}>
                  <span>{copied ? t('Copiado') : t('Copiar texto')}</span>
                  <CopyIcon />
                </button>
              </li>
            ) : null}
            <li>
              <button type="button" className="msgpop__item" onClick={() => { onSelect(); onClose(); }}>
                <span>{t('Selecionar')}</span>
                <CheckCircleIcon />
              </button>
            </li>
            {canDelete ? (
              <li>
                <button type="button" className="msgpop__item msgpop__item--danger" onClick={() => setStep('delete')}>
                  <span>{t('Apagar para todos')}</span>
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

/** Juntas num chip só, como nas DMs: até três emojis e o total. */
export function ReactionSummary({ reactions, onOpen }: { reactions: ChatReaction[]; onOpen: () => void }) {
  if (reactions.length === 0) return null;
  const total = reactions.reduce((sum, r) => sum + r.count, 0);
  const mineToo = reactions.some((r) => r.mine);
  return (
    <div className="reactions">
      <button type="button" className={`reactions__chip${mineToo ? ' is-mine' : ''}`} aria-label={total === 1 ? t('1 reação: {emojis}. Ver quem reagiu', { emojis: reactions.map((r) => r.emoji).join(' ') }) : t('{count} reações: {emojis}. Ver quem reagiu', { count: total, emojis: reactions.map((r) => r.emoji).join(' ') })} onClick={onOpen}>
        <span aria-hidden="true">{reactions.slice(0, 3).map((r) => r.emoji).join('')}</span>
        {total > 1 ? <span className="reactions__n">{total}</span> : null}
      </button>
    </div>
  );
}

/** Quem reagiu à mensagem. Tocar na sua reação tira. */
export function ReactionsSheet({ message, conversationId, canSend, onClose, onReacted }: { message: ChatMessage; conversationId: string; canSend: boolean; onClose: () => void; onReacted: (reactions: ChatReaction[]) => void }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();
  const rows = message.reactions.flatMap((r) => r.people.map((p) => ({ ...p, emoji: r.emoji, mine: r.mine && p === r.people[0] })));
  rows.sort((a, b) => Number(b.mine) - Number(a.mine));
  const total = rows.length;

  async function removeMine(emoji: string) {
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

  return (
    <Sheet title={total === 1 ? t('1 reação') : t('{count} reações', { count: total })} onClose={onClose}>
      {problem ? <Notice tone="error">{problem}</Notice> : null}
      <ul className="reactlist">
        {rows.map((r) => (
          <li key={`${r.userId}-${r.emoji}`}>
            {r.mine && canSend ? (
              <button type="button" className="reactlist__row reactlist__row--mine" disabled={busy} onClick={() => void removeMine(r.emoji)}>
                <span className="reactlist__who">
                  <strong>{t('Você')}</strong>
                  <span>{t('Toque para remover')}</span>
                </span>
                <span className="reactlist__emoji" aria-hidden="true">{r.emoji}</span>
              </button>
            ) : (
              <div className="reactlist__row">
                <span className="reactlist__who">
                  <strong>{r.mine ? t('Você') : r.name}</strong>
                </span>
                <span className="reactlist__emoji" aria-label={t('reagiu com {emoji}', { emoji: r.emoji })}>{r.emoji}</span>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
