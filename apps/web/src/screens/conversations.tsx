import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { ChangeEvent, FormEvent, MouseEvent } from 'react';
import { ChatHead } from '../components/chat-head.tsx';
import { Avatar, Button, Confirm, EmptyState, ErrorState, GroupAvatar, Loading, Notice, PageHead } from '../components/ui.tsx';
import { VoiceBubble, VoiceRecorderBar } from '../components/voice.tsx';
import { NewConversationSheet } from '../components/new-conversation.tsx';
import { ArrowUpIcon, BellOffIcon, CameraIcon, CheckIcon, ChevronDownIcon, CopyIcon, HeartIcon, PlayIcon, ReplyIcon, TrashIcon, MicIcon, MoreIcon, PhotoIcon, PinIcon, PlusIcon, SearchIcon, XIcon } from '../components/icons.tsx';
import { MediaBubble, ReplyThumb } from '../components/chat-media.tsx';
import { MessagePopup, ReactionSummary, ReactionsSheet, hasActions } from '../components/message-actions.tsx';
import { Sheet } from '../components/agenda.tsx';
import { SwipeRow, useTimeReveal } from '../components/swipe-reply.tsx';
import { useChatBackground } from '../lib/chat-bg.ts';
import { readDraft, saveDraft } from '../lib/chat-draft.ts';
import { ChatPrefsSheet } from '../components/chat-prefs.tsx';
import { PollLine } from '../components/date-poll-strip.tsx';
import { MeetupBubble } from '../components/meetup.tsx';
import { EventBubble } from '../components/share-event.tsx';
import { peopleLabel } from '../lib/meetup.ts';
import { SuggestionBubble, SuggestionsSheet } from '../components/suggestions.tsx';
import { api } from '../client.ts';
import { useAsync, usePolling, useTitle } from '../hooks.ts';
import { allDeletable, announceChatsChanged, breakLabel, copyText, filterConversations, formatClock, groupAlbums, isDoubleTap, listTimeLabel, mergeMessages, previewOf, replyPreview, runPositions, seenLabel, timeBreak } from '../lib/chat.ts';
import type { RunPosition } from '../lib/chat.ts';
import { mediaKind, mediaProblem, prepareImage, typingLabel } from '../lib/chat-media.ts';
import { toApiError } from '../lib/errors.ts';
import { FLASH_MATCH_MESSAGE, formatRemaining, minutesLeft } from '../lib/flash.ts';
import type { ChatMessage, ConversationItem } from '../lib/types.ts';
import { Link } from '../router.tsx';
import { t } from '../lib/i18n/index.ts';

export const MESSAGE_MAX = 2000;

// ---------- Lista ----------

const UNDO_MS = 6000;

/** Quando a última conversa foi fechada: a lista entra "voltando" (da esquerda) se acabou de sair de um chat. */
let chatLeftAt = 0;
const BACK_WINDOW_MS = 1500;

export function ConversationsScreen() {
  useTitle(t('Conversas'));
  const [cameBack] = useState(() => Date.now() - chatLeftAt < BACK_WINDOW_MS);
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
    <div className={`convscreen${cameBack ? ' convscreen--back' : ''}`}>
      <PageHead
        title={t('Conversas')}
        action={
          <button type="button" className="iconbtn" aria-label={t('Nova conversa')} onClick={() => setCreating(true)}>
            <PlusIcon />
          </button>
        }
      />
      {creating ? <NewConversationSheet onClose={() => setCreating(false)} /> : null}
      {items.length === 0 ? (
        <EmptyState
          title={t('Nenhuma conversa ainda')}
          action={
            <Link to="/now" className="btn btn--primary">
              {t('Ver quem está no NOW')}
            </Link>
          }
        >
          {t('Quando um convite do NOW for aceito, a conversa com a pessoa abre aqui. Você também pode escrever para qualquer amigo pelo perfil dele ou criar um encontro a partir de um evento.')}
        </EmptyState>
      ) : (
        <>
          <div className="search search--convs" role="search">
            <span className="search__icon" aria-hidden="true">
              <SearchIcon />
            </span>
            <label className="visually-hidden" htmlFor="busca-conversas">
              {t('Buscar nas conversas')}
            </label>
            <input id="busca-conversas" className="search__input search__input--icon" type="search" placeholder={t('Buscar nas conversas')} value={query} maxLength={60} autoComplete="off" onChange={(e) => setQuery(e.target.value)} />
          </div>
          {shown.length === 0 ? (
            <EmptyState title={searching ? t('Nada encontrado para "{trim}"', { trim: query.trim() }) : t('Nenhuma conversa encontrada')}>
              {t('Procure pelo nome da pessoa ou do grupo, pelo @usuário ou por um trecho da última mensagem.')}
              {searching ? (
                <>
                  {' '}
                  <button type="button" className="linkbtn" onClick={() => setQuery('')}>
                    {t('Limpar busca')}
                  </button>
                </>
              ) : null}
            </EmptyState>
          ) : (
            <ul className="list convlist">
              {shown.map((c) => (
                <li key={c.id} className="convitem">
                  <Link to={`/conversas/${c.id}`} className={`convrow${c.unread > 0 ? ' convrow--unread' : ''}`}>
                    {c.other ? <Avatar profile={c.other} size={48} /> : <GroupAvatar name={c.name ?? t('Grupo')} size={48} imageUrl={c.imageUrl} />}
                    <span className="convrow__body">
                      <span className="convrow__top">
                        <span className="convrow__name">{c.other ? c.other.displayName : (c.name ?? 'Grupo')}</span>
                        {c.pinned && !searching ? (
                          <span className="convrow__flag" title={t('Fixada no topo')}>
                            <PinIcon />
                            <span className="visually-hidden">{t('Fixada no topo')}</span>
                          </span>
                        ) : null}
                        {c.muted ? (
                          <span className="convrow__flag" title={t('Avisos silenciados')}>
                            <BellOffIcon />
                            <span className="visually-hidden">{t('Avisos silenciados')}</span>
                          </span>
                        ) : null}
                        {c.lastMessage ? <span className="convrow__time">{listTimeLabel(c.lastMessage.createdAt, now)}</span> : null}
                      </span>
                      <span className="convrow__preview">{previewOf(c.lastMessage)}</span>
                    </span>
                    {c.unread > 0 ? (
                      <span className={`convrow__count${c.muted ? ' convrow__count--muted' : ''}`} aria-label={c.unread === 1 ? t('1 não lida') : t('{count} não lidas', { count: c.unread })}>
                        {c.unread > 9 ? '9+' : c.unread}
                      </span>
                    ) : null}
                  </Link>
                  <button type="button" className="iconbtn convitem__more" aria-label={t('Opções de {name}', { name: c.other ? c.other.displayName : (c.name ?? t('Grupo')) })} onClick={() => setPrefsFor(c)}>
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
          title={prefsFor.other ? prefsFor.other.displayName : (prefsFor.name ?? t('Grupo'))}
          pinned={prefsFor.pinned}
          muted={prefsFor.muted}
          onClose={() => setPrefsFor(undefined)}
          onChanged={() => list.reload()}
        />
      ) : null}
    </div>
  );
}

// ---------- Conversa ----------

const POLL_MS = 5_000;
/** Quantas fotos ou vídeos dá para mandar de uma vez. */
const STAGED_MAX = 10;

interface StagedMedia {
  id: string;
  file: File;
  kind: 'IMAGE' | 'VIDEO';
  url: string;
}

export function ChatScreen({ conversationId }: { conversationId: string }) {
  useEffect(() => () => void (chatLeftAt = Date.now()), []);
  const view = useAsync(() => api.messages(conversationId), [conversationId]);
  usePolling(view.reload, POLL_MS);
  const flash = useAsync(() => api.flashInvites(), [conversationId]);
  usePolling(flash.reload, 10_000);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [older, setOlder] = useState<{ hasMore: boolean; loading: boolean }>({ hasMore: false, loading: false });
  const [draft, setDraft] = useState(() => readDraft(conversationId));
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();
  const [suggesting, setSuggesting] = useState(false);
  const [replyTo, setReplyTo] = useState<ChatMessage | undefined>();
  const background = useChatBackground(conversationId);
  const [actionsFor, setActionsFor] = useState<ChatMessage | undefined>();
  const [reactionsFor, setReactionsFor] = useState<ChatMessage | undefined>();
  const [burst, setBurst] = useState<string | undefined>();
  const lastTap = useRef<{ id: string; at: number; x: number; y: number } | undefined>(undefined);
  const threadRef = useRef<HTMLDivElement>(null);
  const reveal = useTimeReveal(threadRef);
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState<string[] | undefined>();
  const [deleting, setDeleting] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string[] | undefined>();
  const deleteTimer = useRef<number | undefined>(undefined);
  const deleteIds = useRef<string[] | undefined>(undefined);
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [staged, setStaged] = useState<StagedMedia[]>([]);
  const stagedRef = useRef<StagedMedia[]>([]);
  stagedRef.current = staged;
  useEffect(() => () => stagedRef.current.forEach((x) => URL.revokeObjectURL(x.url)), []);
  const typingSentAt = useRef(0);
  const pressTimer = useRef<number | undefined>(undefined);
  const endRef = useRef<HTMLDivElement>(null);
  const lastSeenId = useRef<string | undefined>(undefined);
  const [unseen, setUnseen] = useState(0);
  /** A página inteira rola: vai até o fim do documento, para a última mensagem ficar acima da barra de envio (que é fixa no rodapé). */
  const scrollToEnd = () => window.scrollTo({ top: document.documentElement.scrollHeight });
  const stickToEnd = useRef(true);
  const loadedFirst = useRef(false);

  const chatName = view.data ? (view.data.other ? view.data.other.displayName : (view.data.name ?? t('Grupo'))) : 'Conversa';
  useTitle(chatName);

  useEffect(() => {
    loadedFirst.current = false;
    setMessages([]);
    setReplyTo(undefined);
    setActionsFor(undefined);
    setSelected(undefined);
    setDeleting(false);
    setUnseen(0);
    lastSeenId.current = undefined;
    setDraft(readDraft(conversationId));
    setStaged((current) => {
      current.forEach((x) => URL.revokeObjectURL(x.url));
      return [];
    });
  }, [conversationId]);

  useEffect(
    () => () => {
      // Saiu da conversa com um "desfazer" em espera: apaga agora, para não perder o pedido.
      const ids = deleteIds.current;
      if (ids) void commitDelete(ids);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conversationId],
  );

  useEffect(() => {
    saveDraft(conversationId, draft);
  }, [conversationId, draft]);

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
      if (stickToEnd.current) setUnseen(0);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useLayoutEffect(() => {
    if (stickToEnd.current) scrollToEnd();
  }, [messages.length, view.data?.typing.length, staged.length, replyTo]);

  // Chegou mensagem de outra pessoa enquanto você lia lá em cima: conta para o botão "Novas mensagens".
  useEffect(() => {
    const previous = lastSeenId.current;
    const last = messages[messages.length - 1];
    lastSeenId.current = last?.id;
    if (!previous || !last || last.id === previous || stickToEnd.current) return;
    const from = messages.findIndex((m) => m.id === previous);
    if (from === -1) return;
    const fresh = messages.slice(from + 1).filter((m) => !m.mine && m.kind !== 'SYSTEM').length;
    if (fresh > 0) setUnseen((n) => n + fresh);
  }, [messages]);

  // Fotos e áudios que terminam de carregar depois aumentam a conversa: continua no fim se a pessoa estava lá.
  const hasThread = view.data !== undefined;
  useEffect(() => {
    const el = threadRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (stickToEnd.current) scrollToEnd();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasThread]);

  if (view.loading && !view.data && !view.error) return <Loading />;
  if (view.error && !view.data) {
    if (view.error.code === 'NOT_FOUND') {
      return (
        <>
          <PageHead title={t('Conversa')} back="/conversas" />
          <EmptyState
            title={t('Conversa não encontrada')}
            action={
              <Link to="/conversas" className="btn btn--primary">
                {t('Ver conversas')}
              </Link>
            }
          >
            {t('Ela pode ter sido ocultada por um bloqueio.')}
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

  /** Fotos e vídeos escolhidos (galeria, várias de uma vez, ou câmera) ficam numa prévia até a pessoa enviar. */
  function pickMedia(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;
    setProblem(undefined);
    const room = STAGED_MAX - staged.length;
    const ok: StagedMedia[] = [];
    for (const file of files) {
      const trouble = mediaProblem(file);
      if (trouble) {
        setProblem(trouble);
        continue;
      }
      if (ok.length >= room) {
        setProblem(t('Dá para enviar até {max} fotos ou vídeos de uma vez.', { max: STAGED_MAX }));
        break;
      }
      ok.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, file, kind: mediaKind(file) === 'IMAGE' ? 'IMAGE' : 'VIDEO', url: URL.createObjectURL(file) });
    }
    if (ok.length > 0) setStaged((current) => [...current, ...ok]);
  }

  function unstage(id: string) {
    setStaged((current) => {
      const gone = current.find((x) => x.id === id);
      if (gone) URL.revokeObjectURL(gone.url);
      return current.filter((x) => x.id !== id);
    });
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
    const media = staged;
    if ((text === '' && media.length === 0) || sending) return;
    setSending(true);
    setUploading(media.length > 0);
    setProblem(undefined);
    let reply = replyTo?.id;
    try {
      // Primeiro as fotos (na ordem escolhida), depois o texto, como legenda logo abaixo.
      for (const item of media) {
        const blob = item.kind === 'IMAGE' ? await prepareImage(item.file) : item.file;
        const message = await api.sendMedia(conversationId, blob, reply);
        reply = undefined;
        stickToEnd.current = true;
        setMessages((current) => mergeMessages(current, [message]));
        unstage(item.id);
      }
      setUploading(false);
      if (text !== '') {
        const message = await api.sendText(conversationId, text, reply);
        stickToEnd.current = true;
        setMessages((current) => mergeMessages(current, [message]));
        setDraft('');
        typingSentAt.current = 0;
      }
      setReplyTo(undefined);
    } catch (failure) {
      if (reply === undefined) setReplyTo(undefined);
      setProblem(failure instanceof Error && failure.message === 'grande' ? t('Não consegui reduzir a foto para o tamanho permitido.') : toApiError(failure).message);
    } finally {
      setSending(false);
      setUploading(false);
    }
  }

  // O botão de sugerir lugar vive na mensagem "Flash combinado" mais recente. Encontro antigo, sem essa mensagem, mostra o cartão no fim.
  const matchMessageId = [...messages].reverse().find((m) => m.kind === 'SYSTEM' && m.body === FLASH_MATCH_MESSAGE)?.id;
  const matchCard = match ? (
    <div className="callout chat__match">
      <p className="callout__text">
        <strong>{t('Encontro NOW ativo')}</strong> · acaba em {formatRemaining(minutesLeft(match.expiresAt, serverNow))}
      </p>
      <div className="row-actions">
        <Button small onClick={() => setSuggesting(true)}>
          {t('Sugerir um rolê')}
        </Button>
        <Link to={`/now/encontro/${match.id}`} className="btn btn--secondary btn--small">
          {t('Ver no mapa')}
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
      setProblem(t('Não consegui copiar. Tente de novo.'));
    }
  }
  /** Apaga de verdade no servidor. Falhando, a mensagem volta para a tela e o aviso explica. */
  async function commitDelete(ids: string[]) {
    deleteIds.current = undefined;
    window.clearTimeout(deleteTimer.current);
    try {
      for (const id of ids) {
        const updated = await api.deleteMessage(conversationId, id);
        setMessages((current) => mergeMessages(current, [updated]));
      }
    } catch (failure) {
      setProblem(toApiError(failure).message);
    } finally {
      setPendingDelete(undefined);
    }
  }
  /** As mensagens somem da tela na hora; só são apagadas no servidor depois de alguns segundos, para dar tempo de desfazer. */
  function deleteChosen() {
    if (deleteIds.current) void commitDelete(deleteIds.current);
    const ids = chosen.map((m) => m.id);
    setProblem(undefined);
    deleteIds.current = ids;
    setPendingDelete(ids);
    setDeleting(false);
    setSelected(undefined);
    deleteTimer.current = window.setTimeout(() => void commitDelete(ids), UNDO_MS);
  }
  function undoDelete() {
    window.clearTimeout(deleteTimer.current);
    deleteIds.current = undefined;
    setPendingDelete(undefined);
  }

  const moreButton = (m: ChatMessage) => (
    <button type="button" className="msg__more" aria-label={t('Opções da mensagem')} onClick={() => setActionsFor(m)}>
      <MoreIcon />
    </button>
  );

  const visible = messages.filter((m) => !pendingDelete?.includes(m.id));
  const positions = runPositions(visible);
  const posOf = new Map(visible.map((m, i) => [m.id, positions[i] ?? 'single'] as const));
  const albums = groupAlbums(visible);
  const seen = seenLabel(visible, data.members, isGroup);
  const profileOf = (senderId: string) => (data.other && data.other.userId === senderId ? data.other : data.members.find((x) => x.profile.userId === senderId)?.profile);
  const face = (senderId: string) => {
    const profile = profileOf(senderId);
    return profile ? <Avatar profile={profile} size={28} /> : null;
  };
  const typingProfile = data.other ?? data.members.find((x) => data.typing.includes(x.profile.displayName))?.profile;
  const typingFace = typingProfile ? <Avatar profile={typingProfile} size={28} /> : null;

  /** Toque duplo no balão: coração, como nas DMs. Devolve true se foi o segundo toque. */
  function registerTap(m: ChatMessage, x: number, y: number): boolean {
    if (selected || !data.canSend || m.deleted || !hasActions(m)) return false;
    const now = Date.now();
    const previous = lastTap.current?.id === m.id ? lastTap.current : undefined;
    if (isDoubleTap(previous, { at: now, x, y })) {
      lastTap.current = undefined;
      setBurst(m.id);
      window.setTimeout(() => setBurst((b) => (b === m.id ? undefined : b)), 900);
      if (m.reactions.find((r) => r.mine)?.emoji !== '❤️') void toggleReaction(m, '❤️');
      return true;
    }
    lastTap.current = { id: m.id, at: now, x, y };
    return false;
  }
  function tapBubble(m: ChatMessage, e: MouseEvent) {
    if ((e.target as HTMLElement).closest('button, a, input, textarea, audio, video, [role="slider"]')) return;
    registerTap(m, e.clientX, e.clientY);
  }

  const row = (m: ChatMessage, pos: RunPosition, cell: boolean) => (
    <SwipeRow key={m.id} className={`msg${m.mine ? ' msg--mine' : ''} msg--run-${pos}${cell ? ' msg--cell' : ''}${selected ? ' msg--selecting' : ''}${selected?.includes(m.id) ? ' msg--selected' : ''}`} id={`msg-${m.id}`} enabled={data.canSend && hasActions(m) && !selected} onReply={() => setReplyTo(m)}>
      {selected && hasActions(m) ? (
        <button type="button" className="msg__pick" role="checkbox" aria-checked={selected.includes(m.id)} aria-label={t('Selecionar mensagem de {name}, {time}', { name: m.mine ? t('você') : (m.senderName ?? t('contato')), time: formatClock(m.createdAt) })} onClick={() => toggleChosen(m.id)}>
          <span className={`msg__check${selected.includes(m.id) ? ' is-on' : ''}`} aria-hidden="true">{selected.includes(m.id) ? <CheckIcon /> : null}</span>
        </button>
      ) : null}
      {!cell && !m.mine ? <span className="msg__face">{pos === 'last' || pos === 'single' ? face(m.senderId) : null}</span> : null}
      {!cell && !selected && m.mine && hasActions(m) ? moreButton(m) : null}
      <div className={`bubble${m.mine ? ' bubble--mine' : ''}${m.reactions.length > 0 ? ' bubble--reacted' : ''}${m.deleted ? ' bubble--deleted' : m.kind === 'AUDIO' ? ' bubble--voice' : m.kind === 'IMAGE' || m.kind === 'VIDEO' ? ' bubble--media' : m.kind !== 'TEXT' ? ' bubble--card' : ''}`} title={formatClock(m.createdAt)} onClick={(e) => tapBubble(m, e)} {...pressHandlers(m)}>
        {isGroup && !m.mine && m.senderName && (pos === 'first' || pos === 'single') ? <span className="bubble__sender">{m.senderName}</span> : null}
        {m.replyTo && !m.deleted ? (
          <button type="button" className="bubble__quote" aria-label={t('Ir para a mensagem respondida de {name}', { name: m.replyTo.mine ? t('você') : (m.replyTo.senderName ?? '') })} onClick={() => document.getElementById(`msg-${m.replyTo?.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })}>
            <span className="bubble__quotetext">
              <strong>{m.replyTo.mine ? t('Você') : m.replyTo.senderName}</strong>
              <span>{m.replyTo.deleted ? t('Mensagem apagada') : m.replyTo.preview}</span>
            </span>
            {!m.replyTo.deleted && (m.replyTo.kind === 'IMAGE' || m.replyTo.kind === 'VIDEO') ? <ReplyThumb conversationId={conversationId} messageId={m.replyTo.id} kind={m.replyTo.kind} /> : null}
          </button>
        ) : null}
        {m.deleted ? (
          <p className="bubble__text bubble__text--deleted">{m.mine ? t('Você apagou esta mensagem') : t('Mensagem apagada')}</p>
        ) : m.kind === 'SUGGESTION' && m.suggestion && data.other ? (
          <SuggestionBubble message={m} otherName={data.other.displayName} nowIso={data.now} conversationId={conversationId} onUpdated={(updated) => setMessages((current) => mergeMessages(current, [updated]))} />
        ) : m.kind === 'MEETUP' && m.meetup ? (
          <MeetupBubble meetup={m.meetup} nowIso={data.now} onUpdated={(updated) => setMessages((current) => current.map((x) => (x.id === m.id || x.meetup?.id === updated.id ? { ...x, meetup: updated } : x)))} />
        ) : m.kind === 'AUDIO' && m.audio ? (
          <VoiceBubble message={m} conversationId={conversationId} />
        ) : m.kind === 'IMAGE' || m.kind === 'VIDEO' ? (
          <MediaBubble message={m} conversationId={conversationId} onTap={(x, y) => registerTap(m, x, y)} />
        ) : m.kind === 'EVENT' && m.event ? (
          <EventBubble event={m.event} />
        ) : (
          <p className="bubble__text">{m.body}</p>
        )}
        <ReactionSummary reactions={m.reactions} onOpen={() => setReactionsFor(m)} />
        {burst === m.id ? (
          <span className="bubble__burst" aria-hidden="true">
            <HeartIcon filled />
          </span>
        ) : null}
      </div>
      {!cell && !selected && !m.mine && hasActions(m) ? moreButton(m) : null}
      {!cell ? <time className="msg__stamp" dateTime={m.createdAt}>{formatClock(m.createdAt)}</time> : null}
    </SwipeRow>
  );

  return (
    <div className={`chat chat--enter${background ? ' chat--bg' : ''}`} style={background ? ({ '--chat-bg': `url(${background})` } as CSSProperties) : undefined}>
      {selected ? (
        <header className="selectbar">
          <p className="selectbar__count" role="status">
            {selected.length === 1 ? '1 selecionada' : `${selected.length} selecionadas`}
          </p>
          <button type="button" className="iconbtn selectbar__close" aria-label={t('Cancelar seleção')} onClick={() => setSelected(undefined)}>
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

      <div ref={threadRef} className="chat__thread" aria-live="polite" {...reveal}>
        {older.hasMore ? (
          <div className="chat__older">
            <Button small variant="quiet" loading={older.loading} onClick={loadOlder}>
              {t('Ver mensagens anteriores')}
            </Button>
          </div>
        ) : null}
        {messages.length === 0 ? <p className="muted chat__empty">Nenhuma mensagem ainda. Diga oi{data.other ? ` para ${data.other.displayName}` : ' para o grupo'}.</p> : null}
        {(() => {
          let prev: ChatMessage | undefined;
          return albums.map((group) => {
            const first = group[0] as ChatMessage;
            const last = group[group.length - 1] as ChatMessage;
            const showBreak = timeBreak(prev, first);
            prev = last;
            if (first.kind === 'SYSTEM') {
              return (
                <div key={first.id} className="chat__item">
                  {showBreak ? <p className="chat__day">{breakLabel(first.createdAt, new Date(serverNow))}</p> : null}
                  <p className="chat__system">{first.body}</p>
                  {match && first.id === matchMessageId ? matchCard : null}
                </div>
              );
            }
            const pos = posOf.get(last.id) ?? 'single';
            if (group.length === 1) {
              return (
                <div key={first.id} className={`chat__item chat__item--${pos}`}>
                  {showBreak ? <p className="chat__day">{breakLabel(first.createdAt, new Date(serverNow))}</p> : null}
                  {row(first, posOf.get(first.id) ?? 'single', false)}
                </div>
              );
            }
            return (
              <div key={first.id} className={`chat__item chat__item--${pos}`}>
                {showBreak ? <p className="chat__day">{breakLabel(first.createdAt, new Date(serverNow))}</p> : null}
                <div className={`albumrow${first.mine ? ' albumrow--mine' : ''}`}>
                  {!first.mine ? <span className="msg__face">{pos === 'last' || pos === 'single' ? face(first.senderId) : null}</span> : null}
                  <div className={`album album--${Math.min(group.length, 4)}`} role="group" aria-label={t('{count} fotos', { count: group.length })}>
                    {group.map((m) => row(m, 'middle', true))}
                  </div>
                  <time className="msg__stamp" dateTime={last.createdAt}>{formatClock(last.createdAt)}</time>
                </div>
              </div>
            );
          });
        })()}
        {seen ? <p className="chat__seen">{seen}</p> : null}
        {data.typing.length > 0 ? (
          <div className="msg msg--typing" role="status">
            <span className="msg__face">{typingFace}</span>
            <div className="bubble typingdots" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <span className={isGroup ? 'typingdots__who' : 'visually-hidden'}>{typingLabel(data.typing)}</span>
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      {unseen > 0 ? (
        <button
          type="button"
          className="chat__newbtn"
          onClick={() => {
            stickToEnd.current = true;
            setUnseen(0);
            window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
          }}
        >
          {unseen === 1 ? t('1 mensagem nova') : t('{count} mensagens novas', { count: unseen })}
          <ChevronDownIcon />
        </button>
      ) : null}
      {problem ? <Notice tone="error">{problem}</Notice> : null}
      {uploading ? (
        <p className="muted chat__sending" role="status">
          {t('Enviando…')}
        </p>
      ) : null}
      {replyTo && data.canSend ? (
        <div className="replybar">
          <div className="replybar__text">
            <strong>{t('Respondendo a {name}', { name: replyTo.mine ? t('você') : (replyTo.senderName ?? data.other?.displayName ?? t('mensagem')) })}</strong>
            <span>{replyPreview(replyTo)}</span>
          </div>
          {!replyTo.deleted && (replyTo.kind === 'IMAGE' || replyTo.kind === 'VIDEO') ? <ReplyThumb conversationId={conversationId} messageId={replyTo.id} kind={replyTo.kind} /> : null}
          <button type="button" className="iconbtn" aria-label={t('Cancelar resposta')} onClick={() => setReplyTo(undefined)}>
            <XIcon />
          </button>
        </div>
      ) : null}

      {selected ? (
        <div className="selectactions" role="toolbar" aria-label={t('Ações para as mensagens selecionadas')}>
          <button type="button" className="selectactions__btn" disabled={selected.length !== 1 || !data.canSend} onClick={() => { const only = chosen[0]; if (only) { setReplyTo(only); setSelected(undefined); } }}>
            <ReplyIcon />
            <span>{t('Responder')}</span>
          </button>
          <button type="button" className="selectactions__btn" disabled={copyText(chosen) === ''} onClick={() => void copyChosen()}>
            <CopyIcon />
            <span>{t('Copiar')}</span>
          </button>
          <button type="button" className="selectactions__btn selectactions__btn--danger" disabled={!allDeletable(chosen)} onClick={() => setDeleting(true)}>
            <TrashIcon />
            <span>{t('Apagar')}</span>
          </button>
        </div>
      ) : data.canSend ? (
        <>
          {staged.length > 0 ? (
            <div className="stagebar" role="group" aria-label={staged.length === 1 ? t('1 item para enviar') : t('{count} itens para enviar', { count: staged.length })}>
              <ul className="stagebar__list">
                {staged.map((item, i) => (
                  <li key={item.id} className="stagebar__item">
                    {item.kind === 'IMAGE' ? (
                      <img src={item.url} alt={t('Foto {n}', { n: i + 1 })} draggable={false} />
                    ) : (
                      <span className="stagebar__video">
                        <PlayIcon />
                        <span className="visually-hidden">{t('Vídeo {n}', { n: i + 1 })}</span>
                      </span>
                    )}
                    <button type="button" className="stagebar__remove" aria-label={item.kind === 'IMAGE' ? t('Tirar foto {n}', { n: i + 1 }) : t('Tirar vídeo {n}', { n: i + 1 })} disabled={sending} onClick={() => unstage(item.id)}>
                      <XIcon />
                    </button>
                  </li>
                ))}
                {staged.length < STAGED_MAX ? (
                  <li>
                    <button type="button" className="stagebar__add" aria-label={t('Adicionar mais fotos ou vídeos')} disabled={sending} onClick={() => galleryRef.current?.click()}>
                      <PlusIcon />
                    </button>
                  </li>
                ) : null}
              </ul>
            </div>
          ) : null}
          <form className="composer" onSubmit={send}>
            <label className="visually-hidden" htmlFor="msg">
              Mensagem para {chatName}
            </label>
            <input ref={galleryRef} type="file" multiple accept="image/*,video/mp4,video/webm,video/quicktime" className="visually-hidden" aria-label={t('Escolher fotos ou vídeos')} tabIndex={-1} onChange={pickMedia} />
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="visually-hidden" aria-label={t('Tirar foto')} tabIndex={-1} onChange={pickMedia} />
            {recording ? (
              <VoiceRecorderBar onSend={sendVoice} onCancel={() => setRecording(false)} onProblem={setProblem} />
            ) : (
              <div className="composer__pill">
                <button type="button" className="composer__camera" aria-label={t('Tirar foto')} disabled={sending} onClick={() => cameraRef.current?.click()}>
                  <CameraIcon />
                </button>
                <textarea
                  id="msg"
                  className="composer__input composer__input--pill"
                  rows={1}
                  value={draft}
                  maxLength={MESSAGE_MAX}
                  placeholder={staged.length > 0 ? t('Adicione uma legenda…') : t('Mensagem…')}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    noteTyping(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    // Enter envia no computador; Shift+Enter quebra a linha. No celular o botão envia.
                    if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(hover: hover)').matches) void send(e);
                  }}
                />
                {draft.trim() !== '' || staged.length > 0 ? (
                  <button type="submit" className="composer__sendtext" disabled={sending} aria-busy={sending || undefined} aria-label={t('Enviar')}>
                    <ArrowUpIcon />
                  </button>
                ) : (
                  <span className="composer__tools">
                    <button type="button" className="composer__tool" aria-label={t('Gravar áudio')} onClick={() => {
                        setProblem(undefined);
                        setRecording(true);
                      }}>
                      <MicIcon />
                    </button>
                    <button type="button" className="composer__tool" aria-label={t('Enviar fotos ou vídeos da galeria')} onClick={() => galleryRef.current?.click()}>
                      <PhotoIcon />
                    </button>
                  </span>
                )}
              </div>
            )}
          </form>
        </>
      ) : (
        <Notice>{t('Vocês não são mais amigos. O histórico continua aqui, mas não dá para enviar novas mensagens.')}</Notice>
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

      {reactionsFor ? (
        <ReactionsSheet
          message={messages.find((m) => m.id === reactionsFor.id) ?? reactionsFor}
          conversationId={conversationId}
          canSend={data.canSend}
          onClose={() => setReactionsFor(undefined)}
          onReacted={(reactions) => patchMessage(reactionsFor.id, { reactions })}
        />
      ) : null}

      {pendingDelete ? (
        <div className="undobar" role="status">
          <span>{pendingDelete.length === 1 ? t('Mensagem apagada') : `${pendingDelete.length} mensagens apagadas`}</span>
          <button type="button" onClick={undoDelete}>
            {t('Desfazer')}
          </button>
        </div>
      ) : null}

      {deleting ? (
        <Sheet title={t('Apagar mensagens')} onClose={() => (bulkBusy ? undefined : setDeleting(false))}>
          <Confirm danger question={chosen.length === 1 ? t('Apagar esta mensagem para todos? Você terá alguns segundos para desfazer.') : t('Apagar {length} mensagens para todos? Você terá alguns segundos para desfazer.', { length: chosen.length })} confirmLabel={t('Apagar para todos')} busy={bulkBusy} onCancel={() => setDeleting(false)} onConfirm={deleteChosen} />
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
