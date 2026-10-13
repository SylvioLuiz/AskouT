import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Avatar, Button, EmptyState, ErrorState, Loading, Notice, PageHead } from '../components/ui.tsx';
import { SuggestionBubble, SuggestionsSheet } from '../components/suggestions.tsx';
import { api } from '../client.ts';
import { useAsync, usePolling, useTitle } from '../hooks.ts';
import { announceChatsChanged, dayLabel, formatClock, listTimeLabel, mergeMessages, previewOf } from '../lib/chat.ts';
import { toApiError } from '../lib/errors.ts';
import { formatRemaining, minutesLeft } from '../lib/flash.ts';
import type { ChatMessage } from '../lib/types.ts';
import { Link } from '../router.tsx';

export const MESSAGE_MAX = 2000;

// ---------- Lista ----------

export function ConversationsScreen() {
  useTitle('Conversas');
  const list = useAsync(() => api.conversations(), []);
  usePolling(list.reload, 10_000);
  useEffect(() => {
    if (list.data) announceChatsChanged();
  }, [list.data]);
  const now = new Date();

  if (list.loading && !list.data) return <Loading />;
  if (list.error && !list.data) return <ErrorState message={list.error.message} onRetry={list.reload} />;
  const items = list.data?.items ?? [];

  return (
    <>
      <PageHead title="Conversas" />
      {items.length === 0 ? (
        <EmptyState
          title="Nenhuma conversa ainda"
          action={
            <Link to="/flash" className="btn btn--primary">
              Ver quem está no Flash
            </Link>
          }
        >
          Quando um convite do Flash for aceito, a conversa com a pessoa abre aqui. Você também pode escrever para qualquer amigo pelo perfil dele.
        </EmptyState>
      ) : (
        <ul className="list convlist">
          {items.map((c) => (
            <li key={c.id}>
              <Link to={`/conversas/${c.id}`} className={`convrow${c.unread > 0 ? ' convrow--unread' : ''}`}>
                <Avatar profile={c.other} size={48} />
                <span className="convrow__body">
                  <span className="convrow__top">
                    <span className="convrow__name">{c.other.displayName}</span>
                    {c.lastMessage ? <span className="convrow__time">{listTimeLabel(c.lastMessage.createdAt, now)}</span> : null}
                  </span>
                  <span className="convrow__preview">{previewOf(c.lastMessage)}</span>
                </span>
                {c.unread > 0 ? (
                  <span className="convrow__count" aria-label={`${c.unread} não lida${c.unread === 1 ? '' : 's'}`}>
                    {c.unread > 9 ? '9+' : c.unread}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ---------- Conversa ----------

const POLL_MS = 5_000;

export function ChatScreen({ conversationId }: { conversationId: string }) {
  const view = useAsync(() => api.messages(conversationId), [conversationId]);
  usePolling(view.reload, POLL_MS);
  const flash = useAsync(() => api.flashInvites(), [conversationId]);
  usePolling(flash.reload, 10_000);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [older, setOlder] = useState<{ hasMore: boolean; loading: boolean }>({ hasMore: false, loading: false });
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();
  const [suggesting, setSuggesting] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const stickToEnd = useRef(true);
  const loadedFirst = useRef(false);

  useTitle(view.data ? view.data.other.displayName : 'Conversa');

  useEffect(() => {
    loadedFirst.current = false;
    setMessages([]);
  }, [conversationId]);

  useEffect(() => {
    if (!view.data) return;
    announceChatsChanged(); // abrir a conversa marca como lida
    setMessages((current) => mergeMessages(current, view.data!.messages));
    if (!loadedFirst.current) {
      loadedFirst.current = true;
      setOlder((o) => ({ ...o, hasMore: view.data!.hasMore }));
    }
  }, [view.data]);

  // A página inteira rola; só acompanha as mensagens novas se a pessoa já estiver perto do fim.
  useEffect(() => {
    const onScroll = () => {
      const doc = document.documentElement;
      stickToEnd.current = doc.scrollHeight - window.scrollY - window.innerHeight < 120;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useLayoutEffect(() => {
    if (stickToEnd.current) endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  if (view.loading && !view.data && !view.error) return <Loading />;
  if (view.error && !view.data) {
    if (view.error.code === 'NOT_FOUND') {
      return (
        <>
          <PageHead title="Conversa" back="/conversas" />
          <EmptyState
            title="Conversa não encontrada"
            action={
              <Link to="/conversas" className="btn btn--primary">
                Ver conversas
              </Link>
            }
          >
            Ela pode ter sido ocultada por um bloqueio.
          </EmptyState>
        </>
      );
    }
    return <ErrorState message={view.error.message} onRetry={view.reload} />;
  }
  const data = view.data!;
  const match = flash.data?.matches.find((m) => m.other.userId === data.other.userId);
  const serverNow = Date.parse(data.now);

  async function loadOlder() {
    const first = messages[0];
    if (!first) return;
    setOlder((o) => ({ ...o, loading: true }));
    stickToEnd.current = false;
    try {
      const page = await api.messages(conversationId, { before: first.createdAt });
      setMessages((current) => mergeMessages(page.messages, current));
      setOlder({ hasMore: page.hasMore, loading: false });
    } catch (failure) {
      setProblem(toApiError(failure).message);
      setOlder((o) => ({ ...o, loading: false }));
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (text === '' || sending) return;
    setSending(true);
    setProblem(undefined);
    try {
      const message = await api.sendText(conversationId, text);
      stickToEnd.current = true;
      setMessages((current) => mergeMessages(current, [message]));
      setDraft('');
    } catch (failure) {
      setProblem(toApiError(failure).message);
    } finally {
      setSending(false);
    }
  }

  let lastDay = '';
  return (
    <div className="chat">
      <PageHead title={data.other.displayName} back="/conversas" subtitle={`@${data.other.username}`} />

      {match ? (
        <div className="callout chat__match">
          <p className="callout__text">
            <strong>Encontro Flash ativo</strong> · acaba em {formatRemaining(minutesLeft(match.expiresAt, serverNow))}
          </p>
          <div className="row-actions">
            <Button small onClick={() => setSuggesting(true)}>
              Sugerir um lugar
            </Button>
            <Link to={`/flash/encontro/${match.id}`} className="btn btn--secondary btn--small">
              Ver no mapa
            </Link>
          </div>
        </div>
      ) : null}

      <div className="chat__thread" aria-live="polite">
        {older.hasMore ? (
          <div className="chat__older">
            <Button small variant="quiet" loading={older.loading} onClick={loadOlder}>
              Ver mensagens anteriores
            </Button>
          </div>
        ) : null}
        {messages.length === 0 ? <p className="muted chat__empty">Nenhuma mensagem ainda. Diga oi para {data.other.displayName}.</p> : null}
        {messages.map((m) => {
          const day = dayLabel(m.createdAt, new Date(serverNow));
          const showDay = day !== lastDay;
          lastDay = day;
          return (
            <div key={m.id} className="chat__item">
              {showDay ? <p className="chat__day">{day}</p> : null}
              <div className={`bubble${m.mine ? ' bubble--mine' : ''}${m.kind === 'SUGGESTION' ? ' bubble--card' : ''}`}>
                {m.kind === 'SUGGESTION' && m.suggestion ? <SuggestionBubble card={m.suggestion} nowIso={data.now} /> : <p className="bubble__text">{m.body}</p>}
                <span className="bubble__time">{formatClock(m.createdAt)}</span>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {problem ? <Notice tone="error">{problem}</Notice> : null}

      {data.canSend ? (
        <form className="composer" onSubmit={send}>
          <label className="visually-hidden" htmlFor="msg">
            Mensagem para {data.other.displayName}
          </label>
          <textarea
            id="msg"
            className="composer__input"
            rows={1}
            value={draft}
            maxLength={MESSAGE_MAX}
            placeholder="Escreva uma mensagem"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter envia no computador; Shift+Enter quebra a linha. No celular o botão envia.
              if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(hover: hover)').matches) void send(e);
            }}
          />
          <Button type="submit" loading={sending} disabled={draft.trim() === ''}>
            Enviar
          </Button>
        </form>
      ) : (
        <Notice>Vocês não são mais amigos. O histórico continua aqui, mas não dá para enviar novas mensagens.</Notice>
      )}

      {suggesting && match ? (
        <SuggestionsSheet
          inviteId={match.id}
          conversationId={conversationId}
          otherName={data.other.displayName}
          onClose={() => setSuggesting(false)}
          onSent={(message) => {
            stickToEnd.current = true;
            setMessages((current) => mergeMessages(current, [message]));
            setSuggesting(false);
          }}
        />
      ) : null}
    </div>
  );
}
