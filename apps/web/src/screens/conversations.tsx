import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent, MouseEvent } from 'react';
import { ChatHead } from '../components/chat-head.tsx';
import { Avatar, Button, Confirm, EmptyState, ErrorState, GroupAvatar, Loading, Notice, PageHead } from '../components/ui.tsx';
import { VoiceBubble, VoiceRecorderBar } from '../components/voice.tsx';
import { NewConversationSheet } from '../components/new-conversation.tsx';
import { ArrowUpIcon, BellOffIcon, CheckIcon, CopyIcon, ReplyIcon, TrashIcon, MicIcon, MoreIcon, PhotoIcon, PinIcon, PlusIcon, SearchIcon, XIcon } from '../components/icons.tsx';
import { MediaBubble } from '../components/chat-media.tsx';
import { MessagePopup, hasActions } from '../components/message-actions.tsx';
import { Sheet } from '../components/agenda.tsx';
import { SwipeRow } from '../components/swipe-reply.tsx';
import { ChatPrefsSheet } from '../components/chat-prefs.tsx';
import { PollLine } from '../components/date-poll-strip.tsx';
import { MeetupBubble } from '../components/meetup.tsx';
import { EventBubble } from '../components/share-event.tsx';
import { peopleLabel } from '../lib/meetup.ts';
import { SuggestionBubble, SuggestionsSheet } from '../components/suggestions.tsx';
import { api } from '../client.ts';
import { useAsync, usePolling, useTitle } from '../hooks.ts';
import { allDeletable, announceChatsChanged, copyText, dayLabel, filterConversations, formatClock, listTimeLabel, mergeMessages, previewOf, replyPreview } from '../lib/chat.ts';
import { mediaKind, mediaProblem, prepareImage, typingLabel } from '../lib/chat-media.ts';
import { toApiError } from '../lib/errors.ts';
import { FLASH_MATCH_MESSAGE, formatRemaining, minutesLeft } from '../lib/flash.ts';
import type { ChatMessage, ConversationItem } from '../lib/types.ts';
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
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [prefsFor, setPrefsFor] = useState<ConversationItem | undefined>();
  const now = new Date();

  if (list.loading && !list.data) return <Loading />;
  if (list.error && !list.data) return <ErrorState message={list.error.message} onRetry={list.reload} />;
  const items = list.data?.items ?? [];
  const shown = filterConversations(items, query);
  const searching = query.trim() !== '';

  return (
    <>
      <PageHead
        title="Conversas"
        action={
          <button type="button" className="iconbtn" aria-label="Nova conversa" onClick={() => setCreating(true)}>
            <PlusIcon />
          </button>
        }
      />
      {creating ? <NewConversationSheet onClose={() => setCreating(false)} /> : null}
      {items.length === 0 ? (
        <EmptyState
          title="Nenhuma conversa ainda"
          action={
            <Link to="/flash" className="btn btn--primary">
              Ver quem está no Flash
            </Link>
          }
        >
          Quando um convite do Flash for aceito, a conversa com a pessoa abre aqui. Você também pode escrever para qualquer amigo pelo perfil dele ou criar um encontro a partir de um evento.
        </EmptyState>
      ) : (
        <>
          <div className="search search--convs" role="search">
            <span className="search__icon" aria-hidden="true">
              <SearchIcon />
            </span>
            <label className="visually-hidden" htmlFor="busca-conversas">
              Buscar nas conversas
            </label>
            <input id="busca-conversas" className="search__input search__input--icon" type="search" placeholder="Buscar nas conversas" value={query} maxLength={60} autoComplete="off" onChange={(e) => setQuery(e.target.value)} />
          </div>
          {shown.length === 0 ? (
            <EmptyState title="Nenhuma conversa encontrada">Procure pelo nome da pessoa ou do grupo, pelo @usuário ou por um trecho da última mensagem.</EmptyState>
          ) : (
            <ul className="list convlist">
              {shown.map((c) => (
                <li key={c.id} className="convitem">
                  <Link to={`/conversas/${c.id}`} className={`convrow${c.unread > 0 ? ' convrow--unread' : ''}`}>
                    {c.other ? <Avatar profile={c.other} size={48} /> : <GroupAvatar name={c.name ?? 'Grupo'} size={48} imageUrl={c.imageUrl} />}
                    <span className="convrow__body">
                      <span className="convrow__top">
                        <span className="convrow__name">{c.other ? c.other.displayName : (c.name ?? 'Grupo')}</span>
                        {c.pinned && !searching ? (
                          <span className="convrow__flag" title="Fixada no topo">
                            <PinIcon />
                            <span className="visually-hidden">Fixada no topo</span>
                          </span>
                        ) : null}
                        {c.muted ? (
                          <span className="convrow__flag" title="Avisos silenciados">
                            <BellOffIcon />
                            <span className="visually-hidden">Avisos silenciados</span>
                          </span>
                        ) : null}
                        {c.lastMessage ? <span className="convrow__time">{listTimeLabel(c.lastMessage.createdAt, now)}</span> : null}
                      </span>
                      <span className="convrow__preview">{previewOf(c.lastMessage)}</span>
                    </span>
                    {c.unread > 0 ? (
                      <span className={`convrow__count${c.muted ? ' convrow__count--muted' : ''}`} aria-label={`${c.unread} não lida${c.unread === 1 ? '' : 's'}`}>
                        {c.unread > 9 ? '9+' : c.unread}
                      </span>
                    ) : null}
                  </Link>
                  <button type="button" className="iconbtn convitem__more" aria-label={`Opções de ${c.other ? c.other.displayName : (c.name ?? 'Grupo')}`} onClick={() => setPrefsFor(c)}>
                    <MoreIcon />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {prefsFor ? (
        <ChatPrefsSheet
          conversationId={prefsFor.id}
          title={prefsFor.other ? prefsFor.other.displayName : (prefsFor.name ?? 'Grupo')}
          pinned={prefsFor.pinned}
          muted={prefsFor.muted}
          onClose={() => setPrefsFor(undefined)}
          onChanged={() => list.reload()}
        />
      ) : null}
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
  const [recording, setRecording] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();
  const [suggesting, setSuggesting] = useState(false);
  const [replyTo, setReplyTo] = useState<ChatMessage | undefined>();
  const [actionsFor, setActionsFor] = useState<ChatMessage | undefined>();
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState<string[] | undefined>();
  const [deleting, setDeleting] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const typingSentAt = useRef(0);
  const pressTimer = useRef<number | undefined>(undefined);
  const endRef = useRef<HTMLDivElement>(null);
  const stickToEnd = useRef(true);
  const loadedFirst = useRef(false);

  const chatName = view.data ? (view.data.other ? view.data.other.displayName : (view.data.name ?? 'Grupo')) : 'Conversa';
  useTitle(chatName);

  useEffect(() => {
    loadedFirst.current = false;
    setMessages([]);
    setReplyTo(undefined);
    setActionsFor(undefined);
    setSelected(undefined);
    setDeleting(false);
  }, [conversationId]);

  // Esc sai da seleção.
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(undefined);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

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
  const isGroup = data.type === 'GROUP';
  const match = data.other ? flash.data?.matches.find((m) => m.other.userId === data.other?.userId) : undefined;
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

  function patchMessage(messageId: string, patch: Partial<ChatMessage>) {
    setMessages((current) => current.map((x) => (x.id === messageId ? { ...x, ...patch } : x)));
  }

  async function sendVoice(audio: string, durationMs: number) {
    const message = await api.sendAudio(conversationId, audio, durationMs, replyTo?.id);
    stickToEnd.current = true;
    setReplyTo(undefined);
    setMessages((current) => mergeMessages(current, [message]));
  }

  async function pickMedia(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || uploading) return;
    const trouble = mediaProblem(file);
    if (trouble) {
      setProblem(trouble);
      return;
    }
    setUploading(true);
    setProblem(undefined);
    try {
      const blob = mediaKind(file) === 'IMAGE' ? await prepareImage(file) : file;
      const message = await api.sendMedia(conversationId, blob, replyTo?.id);
      stickToEnd.current = true;
      setReplyTo(undefined);
      setMessages((current) => mergeMessages(current, [message]));
    } catch (failure) {
      setProblem(failure instanceof Error && failure.message === 'grande' ? 'Não consegui reduzir a foto para o tamanho permitido.' : toApiError(failure).message);
    } finally {
      setUploading(false);
    }
  }

  async function toggleReaction(m: ChatMessage, emoji: string) {
    try {
      const result = await api.reactMessage(conversationId, m.id, emoji);
      patchMessage(m.id, { reactions: result.reactions });
    } catch (failure) {
      setProblem(toApiError(failure).message);
    }
  }

  function noteTyping(text: string) {
    if (text.trim() === '' || Date.now() - typingSentAt.current < 3_000) return;
    typingSentAt.current = Date.now();
    void api.sendTyping(conversationId).catch(() => undefined);
  }

  // Segurar a mensagem (celular) ou clicar com o botão direito (computador) abre as opções.
  function pressHandlers(m: ChatMessage) {
    if (selected || !hasActions(m)) return {};
    return {
      onContextMenu: (e: MouseEvent) => {
        e.preventDefault();
        setActionsFor(m);
      },
      onTouchStart: () => {
        window.clearTimeout(pressTimer.current);
        pressTimer.current = window.setTimeout(() => setActionsFor(m), 450);
      },
      onTouchEnd: () => window.clearTimeout(pressTimer.current),
      onTouchMove: () => window.clearTimeout(pressTimer.current),
    };
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (text === '' || sending) return;
    setSending(true);
    setProblem(undefined);
    try {
      const message = await api.sendText(conversationId, text, replyTo?.id);
      stickToEnd.current = true;
      setMessages((current) => mergeMessages(current, [message]));
      setDraft('');
      setReplyTo(undefined);
      typingSentAt.current = 0;
    } catch (failure) {
      setProblem(toApiError(failure).message);
    } finally {
      setSending(false);
    }
  }

  // O botão de sugerir lugar vive na mensagem "Flash combinado" mais recente. Encontro antigo, sem essa mensagem, mostra o cartão no fim.
  const matchMessageId = [...messages].reverse().find((m) => m.kind === 'SYSTEM' && m.body === FLASH_MATCH_MESSAGE)?.id;
  const matchCard = match ? (
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
  ) : null;

  const chosen = selected ? messages.filter((m) => selected.includes(m.id)) : [];
  function toggleChosen(id: string) {
    setSelected((current) => {
      if (!current) return current;
      const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
      return next.length === 0 ? undefined : next;
    });
  }
  async function copyChosen() {
    const text = copyText(chosen);
    if (text === '') return;
    try {
      await navigator.clipboard.writeText(text);
      setSelected(undefined);
    } catch {
      setProblem('Não consegui copiar. Tente de novo.');
    }
  }
  async function deleteChosen() {
    setBulkBusy(true);
    setProblem(undefined);
    try {
      for (const m of chosen) {
        const updated = await api.deleteMessage(conversationId, m.id);
        setMessages((current) => mergeMessages(current, [updated]));
      }
      setDeleting(false);
      setSelected(undefined);
    } catch (failure) {
      setProblem(toApiError(failure).message);
      setDeleting(false);
    } finally {
      setBulkBusy(false);
    }
  }

  const moreButton = (m: ChatMessage) => (
    <button type="button" className="msg__more" aria-label="Opções da mensagem" onClick={() => setActionsFor(m)}>
      <MoreIcon />
    </button>
  );

  let lastDay = '';
  return (
    <div className="chat">
      {selected ? (
        <header className="selectbar">
          <p className="selectbar__count" role="status">
            {selected.length === 1 ? '1 selecionada' : `${selected.length} selecionadas`}
          </p>
          <button type="button" className="iconbtn selectbar__close" aria-label="Cancelar seleção" onClick={() => setSelected(undefined)}>
            <XIcon />
          </button>
        </header>
      ) : (
      <ChatHead
        conversationId={conversationId}
        other={data.other}
        groupName={data.name}
        groupImageUrl={data.imageUrl}
        below={<PollLine conversationId={conversationId} />}
        pinned={data.pinned}
        muted={data.muted}
        onPrefsChanged={view.reload}
        subtitle={isGroup ? `${peopleLabel(data.memberCount)} · toque para ver o grupo` : data.other ? `@${data.other.username}` : undefined}
        onCleared={() => {
          setMessages([]);
          setOlder({ hasMore: false, loading: false });
          view.reload();
        }}
      />
      )}

      <div className="chat__thread" aria-live="polite">
        {older.hasMore ? (
          <div className="chat__older">
            <Button small variant="quiet" loading={older.loading} onClick={loadOlder}>
              Ver mensagens anteriores
            </Button>
          </div>
        ) : null}
        {messages.length === 0 ? <p className="muted chat__empty">Nenhuma mensagem ainda. Diga oi{data.other ? ` para ${data.other.displayName}` : ' para o grupo'}.</p> : null}
        {messages.map((m) => {
          const day = dayLabel(m.createdAt, new Date(serverNow));
          const showDay = day !== lastDay;
          lastDay = day;
          return (
            <div key={m.id} className="chat__item">
              {showDay ? <p className="chat__day">{day}</p> : null}
              {m.kind === 'SYSTEM' ? (
                <>
                  <p className="chat__system">{m.body}</p>
                  {match && m.id === matchMessageId ? matchCard : null}
                </>
              ) : (
                <>
                  <SwipeRow className={`msg${m.mine ? ' msg--mine' : ''}${selected ? ' msg--selecting' : ''}${selected?.includes(m.id) ? ' msg--selected' : ''}`} id={`msg-${m.id}`} enabled={data.canSend && hasActions(m) && !selected} onReply={() => setReplyTo(m)}>
                    {selected && hasActions(m) ? (
                      <button type="button" className="msg__pick" role="checkbox" aria-checked={selected.includes(m.id)} aria-label={`Selecionar mensagem de ${m.mine ? 'você' : (m.senderName ?? 'contato')}, ${formatClock(m.createdAt)}`} onClick={() => toggleChosen(m.id)}>
                        <span className={`msg__check${selected.includes(m.id) ? ' is-on' : ''}`} aria-hidden="true">{selected.includes(m.id) ? <CheckIcon /> : null}</span>
                      </button>
                    ) : null}
                    {!selected && m.mine && hasActions(m) ? moreButton(m) : null}
                    <div className={`bubble${m.mine ? ' bubble--mine' : ''}${m.deleted ? ' bubble--deleted' : m.kind === 'AUDIO' ? ' bubble--voice' : m.kind === 'IMAGE' || m.kind === 'VIDEO' ? ' bubble--media' : m.kind !== 'TEXT' ? ' bubble--card' : ''}`} {...pressHandlers(m)}>
                      {isGroup && !m.mine && m.senderName ? <span className="bubble__sender">{m.senderName}</span> : null}
                      {m.replyTo && !m.deleted ? (
                        <button type="button" className="bubble__quote" aria-label={`Ir para a mensagem respondida de ${m.replyTo.mine ? 'você' : m.replyTo.senderName}`} onClick={() => document.getElementById(`msg-${m.replyTo?.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })}>
                          <strong>{m.replyTo.mine ? 'Você' : m.replyTo.senderName}</strong>
                          <span>{m.replyTo.deleted ? 'Mensagem apagada' : m.replyTo.preview}</span>
                        </button>
                      ) : null}
                      {m.deleted ? (
                        <p className="bubble__text bubble__text--deleted">{m.mine ? 'Você apagou esta mensagem' : 'Mensagem apagada'}</p>
                      ) : m.kind === 'SUGGESTION' && m.suggestion && data.other ? (
                        <SuggestionBubble message={m} otherName={data.other.displayName} nowIso={data.now} conversationId={conversationId} onUpdated={(updated) => setMessages((current) => mergeMessages(current, [updated]))} />
                      ) : m.kind === 'MEETUP' && m.meetup ? (
                        <MeetupBubble meetup={m.meetup} nowIso={data.now} onUpdated={(updated) => setMessages((current) => current.map((x) => (x.id === m.id || x.meetup?.id === updated.id ? { ...x, meetup: updated } : x)))} />
                      ) : m.kind === 'AUDIO' && m.audio ? (
                        <VoiceBubble message={m} conversationId={conversationId} />
                      ) : m.kind === 'IMAGE' || m.kind === 'VIDEO' ? (
                        <MediaBubble message={m} conversationId={conversationId} />
                      ) : m.kind === 'EVENT' && m.event ? (
                        <EventBubble event={m.event} />
                      ) : (
                        <p className="bubble__text">{m.body}</p>
                      )}
                      <span className="bubble__time">{formatClock(m.createdAt)}</span>
                    </div>
                    {!selected && !m.mine && hasActions(m) ? moreButton(m) : null}
                  </SwipeRow>
                  {m.reactions.length > 0 ? (
                    <div className={`reactions${m.mine ? ' reactions--mine' : ''}`}>
                      {m.reactions.map((r) => (
                        <button key={r.emoji} type="button" className={`reactions__chip${r.mine ? ' is-mine' : ''}`} aria-pressed={r.mine} aria-label={`${r.emoji} ${r.count} ${r.count === 1 ? 'reação' : 'reações'}${r.mine ? ', sua. Toque para tirar' : ''}`} disabled={!data.canSend} onClick={() => void toggleReaction(m, r.emoji)}>
                          <span aria-hidden="true">{r.emoji}</span>
                          {r.count > 1 ? <span className="reactions__n">{r.count}</span> : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </>
              )}
            </div>
          );
        })}
        {match && !matchMessageId ? matchCard : null}
        {data.typing.length > 0 ? (
          <p className="chat__typing" role="status">
            {typingLabel(data.typing)}
          </p>
        ) : null}
        <div ref={endRef} />
      </div>

      {problem ? <Notice tone="error">{problem}</Notice> : null}
      {uploading ? (
        <p className="muted chat__sending" role="status">
          Enviando…
        </p>
      ) : null}
      {replyTo && data.canSend ? (
        <div className="replybar">
          <div className="replybar__text">
            <strong>Respondendo a {replyTo.mine ? 'você' : (replyTo.senderName ?? data.other?.displayName ?? 'mensagem')}</strong>
            <span>{replyPreview(replyTo)}</span>
          </div>
          <button type="button" className="iconbtn" aria-label="Cancelar resposta" onClick={() => setReplyTo(undefined)}>
            <XIcon />
          </button>
        </div>
      ) : null}

      {selected ? (
        <div className="selectactions" role="toolbar" aria-label="Ações para as mensagens selecionadas">
          <button type="button" className="selectactions__btn" disabled={selected.length !== 1 || !data.canSend} onClick={() => { const only = chosen[0]; if (only) { setReplyTo(only); setSelected(undefined); } }}>
            <ReplyIcon />
            <span>Responder</span>
          </button>
          <button type="button" className="selectactions__btn" disabled={copyText(chosen) === ''} onClick={() => void copyChosen()}>
            <CopyIcon />
            <span>Copiar</span>
          </button>
          <button type="button" className="selectactions__btn selectactions__btn--danger" disabled={!allDeletable(chosen)} onClick={() => setDeleting(true)}>
            <TrashIcon />
            <span>Apagar</span>
          </button>
        </div>
      ) : data.canSend ? (
        <form className="composer" onSubmit={send}>
          <label className="visually-hidden" htmlFor="msg">
            Mensagem para {chatName}
          </label>
          {recording ? null : (
            <>
              <input ref={fileRef} type="file" accept="image/*,video/mp4,video/webm,video/quicktime" className="visually-hidden" aria-label="Escolher foto ou vídeo" tabIndex={-1} onChange={(e) => void pickMedia(e)} />
              <button type="button" className="iconbtn composer__attach" aria-label="Enviar foto ou vídeo" disabled={uploading} onClick={() => fileRef.current?.click()}>
                <PhotoIcon />
              </button>
            </>
          )}
          {recording ? (
            <VoiceRecorderBar onSend={sendVoice} onCancel={() => setRecording(false)} onProblem={setProblem} />
          ) : (
            <div className="commentbox composer__box">
              <textarea
                id="msg"
                className="composer__input"
                rows={1}
                value={draft}
                maxLength={MESSAGE_MAX}
                placeholder="Escreva uma mensagem"
                onChange={(e) => {
                  setDraft(e.target.value);
                  noteTyping(e.target.value);
                }}
                onKeyDown={(e) => {
                  // Enter envia no computador; Shift+Enter quebra a linha. No celular o botão envia.
                  if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(hover: hover)').matches) void send(e);
                }}
              />
              {draft.trim() !== '' ? (
                <button type="submit" className="commentbox__send composer__send" disabled={sending} aria-label="Enviar mensagem" aria-busy={sending || undefined}>
                  <ArrowUpIcon />
                </button>
              ) : (
                <button type="button" className="commentbox__send composer__send" aria-label="Gravar áudio" onClick={() => {
                    setProblem(undefined);
                    setRecording(true);
                  }}>
                  <MicIcon />
                </button>
              )}
            </div>
          )}
        </form>
      ) : (
        <Notice>Vocês não são mais amigos. O histórico continua aqui, mas não dá para enviar novas mensagens.</Notice>
      )}

      {actionsFor ? (
        <MessagePopup
          message={actionsFor}
          conversationId={conversationId}
          canSend={data.canSend}
          onClose={() => setActionsFor(undefined)}
          onReply={() => setReplyTo(actionsFor)}
          onSelect={() => setSelected([actionsFor.id])}
          onReacted={(reactions) => patchMessage(actionsFor.id, { reactions })}
          onDeleted={(updated) => setMessages((current) => mergeMessages(current, [updated]))}
        />
      ) : null}

      {deleting ? (
        <Sheet title="Apagar mensagens" onClose={() => (bulkBusy ? undefined : setDeleting(false))}>
          <Confirm danger question={chosen.length === 1 ? 'Apagar esta mensagem para todos? Não dá para desfazer.' : `Apagar ${chosen.length} mensagens para todos? Não dá para desfazer.`} confirmLabel="Apagar para todos" busy={bulkBusy} onCancel={() => setDeleting(false)} onConfirm={() => void deleteChosen()} />
        </Sheet>
      ) : null}

      {suggesting && match ? (
        <SuggestionsSheet
          inviteId={match.id}
          conversationId={conversationId}
          otherName={data.other?.displayName ?? ''}
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
