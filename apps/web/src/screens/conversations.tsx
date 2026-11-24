import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties } from 'react';
import type { ChangeEvent, ClipboardEvent as ReactClipboardEvent, FormEvent, MouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { ChatHead } from '../components/chat-head.tsx';
import { Avatar, Button, Confirm, EmptyState, ErrorState, GroupAvatar, Loading, Notice, PageHead } from '../components/ui.tsx';
import { VOICE_CANCEL_DX, VOICE_LOCK_DY, VoiceBubble, VoiceRecorderBar } from '../components/voice.tsx';
import type { VoiceControl } from '../components/voice.tsx';
import { haptic } from '../lib/haptics.ts';
import { NewConversationSheet } from '../components/new-conversation.tsx';
import { UsersIcon, ArrowUpIcon, BellOffIcon, CameraIcon, ChatIcon, CheckIcon, ChevronDownIcon, ChevronLeftIcon, CopyIcon, EditIcon, HeartIcon, PlayIcon, ReplyIcon, TrashIcon, MicIcon, MoreIcon, PhotoIcon, PinIcon, PlusIcon, SearchIcon, XIcon } from '../components/icons.tsx';
import { MediaBubble, ReplyThumb, galleryOf } from '../components/chat-media.tsx';
import { ImageEditor } from '../components/image-editor.tsx';
import { canEditImage } from '../lib/image-edit.ts';
import { FileBubble } from '../components/chat-file.tsx';
import { LinkedText } from '../components/linked-text.tsx';
import { MatchPin } from '../components/match-pin.tsx';
import { CHAT_FILE_ACCEPT, documentType, fileProblem } from '../lib/chat-file.ts';
import { MessagePopup, ReactionSummary, ReactionsSheet, hasActions } from '../components/message-actions.tsx';
import { Sheet } from '../components/agenda.tsx';
import { SwipeRow, useTimeReveal } from '../components/swipe-reply.tsx';
import { useChatBackground } from '../lib/chat-bg.ts';
import { chatColorStyle } from '../lib/chat-color.ts';
import { readDraft, saveDraft } from '../lib/chat-draft.ts';
import { ChatPrefsSheet } from '../components/chat-prefs.tsx';
import { PollLine } from '../components/date-poll-strip.tsx';
import { MeetupBubble } from '../components/meetup.tsx';
import { EventBubble } from '../components/share-event.tsx';
import { ProfileBubble } from '../components/profile-bubble.tsx';
import { VenueBubble } from '../components/venue-bubble.tsx';
import { peopleLabel } from '../lib/meetup.ts';
import { PlaceMapSheet, SuggestionBubble, SuggestionsSheet } from '../components/suggestions.tsx';
import { api } from '../client.ts';
import { useAsync, useLiveRefresh, usePolling, useTitle } from '../hooks.ts';
import { PullRefresh } from '../components/pull-refresh.tsx';
import { useWideDesktop } from '../lib/use-desktop.ts';
import type { ConversationTab } from '../lib/chat.ts';
import { allDeletable, announceChatsChanged, breakLabel, copyText, dayPillLabel, firstUnreadId, filterConversations, formatClock, inConversationTab, unreadInTab, groupAlbums, isDoubleTap, LONG_PRESS_MS, listTimeLabel, mergeMessages, previewOf, replyPreview, runPositions, seenLabel, timeBreak } from '../lib/chat.ts';
import type { RunPosition } from '../lib/chat.ts';
import { CHAT_VIDEO_MAX_BYTES, mediaKind, mediaProblem, prepareImage, typingLabel } from '../lib/chat-media.ts';
import { prepareVideoUpload, withMediaType } from '../lib/media-file.ts';
import { canCompressVideo, prepareProgressText } from '../lib/video-prepare.ts';
import { ApiError, toApiError } from '../lib/errors.ts';
import { safeImage } from '../lib/explore.ts';
import { CommentGifView, CommentTools, GifImage } from '../components/comment-tools.tsx';
import type { ChatMessage, CommentGif, ConversationItem, MessageStory, PublicProfile } from '../lib/types.ts';
import { StoryViewer } from '../components/event-story.tsx';
import { Link, navigate } from '../router.tsx';
import { t } from '../lib/i18n/index.ts';

export const MESSAGE_MAX = 2000;

// ---------- Lista ----------

const UNDO_MS = 6000;

/** Quando a última conversa foi fechada: a lista entra "voltando" (da esquerda) se acabou de sair de um chat. */
let chatLeftAt = 0;
const BACK_WINDOW_MS = 1500;

/** A aba escolhida (Todas, Individuais, Grupos) fica lembrada enquanto o app está aberto, para voltar do chat nela. */
const CONV_TAB_KEY = 'askout:conv-tab';
function readConvTab(): ConversationTab {
  try {
    const saved = sessionStorage.getItem(CONV_TAB_KEY);
    return saved === 'direct' || saved === 'group' ? saved : 'all';
  } catch {
    return 'all';
  }
}

export function ConversationsScreen({ activeId, split = false }: { activeId?: string; split?: boolean } = {}) {
  // Lado a lado com o chat (computador): quem dá o título da aba é a conversa aberta.
  useTitle(split && activeId ? undefined : t('Conversas'));
  const [cameBack] = useState(() => Date.now() - chatLeftAt < BACK_WINDOW_MS);
  const list = useAsync(() => api.conversations(), []);
  // Convites para grupos de amigos ainda sem resposta (o atalho "Grupos de amigos" mostra quantos). Falha aqui não atrapalha a lista.
  const communities = useAsync(() => api.communities().catch(() => ({ items: [], invites: [] })), []);
  const groupInvites = communities.data?.invites.length ?? 0;
  useLiveRefresh(list.reload, 5_000);
  useEffect(() => {
    if (list.data) announceChatsChanged();
  }, [list.data]);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<ConversationTab>(readConvTab);
  function chooseTab(next: ConversationTab) {
    setTab(next);
    try {
      sessionStorage.setItem(CONV_TAB_KEY, next);
    } catch {
      // Sem armazenamento (aba anônima etc.): a aba só não fica lembrada.
    }
  }
  const [prefsFor, setPrefsFor] = useState<ConversationItem | undefined>();
  const now = new Date();

  // O botão + fica fora do PullRefresh e da lista: os dois ganham `transform` (o puxar e a animação de volta),
  // e um `position: fixed` dentro de um elemento com transform passa a andar junto com ele.
  const fab = (
    <>
      <button type="button" className={`fab${split ? ' fab--split' : ''}`} onClick={() => setCreating(true)}>
        <PlusIcon />
        {t('Nova conversa')}
      </button>
      {creating ? <NewConversationSheet onClose={() => setCreating(false)} /> : null}
    </>
  );

  if (list.loading && !list.data) {
    return (
      <>
        <ConversationsSkeleton />
        {fab}
      </>
    );
  }
  if (list.error && !list.data) return <ErrorState message={list.error.message} onRetry={list.reload} />;
  const items = list.data?.items ?? [];
  const requestCount = list.data?.requestCount ?? 0;
  const requestUnread = list.data?.requestUnread ?? 0;
  const shown = filterConversations(items, query).filter((c) => inConversationTab(c, tab));
  const tabs: { id: ConversationTab; label: string }[] = [
    { id: 'all', label: t('Todas') },
    { id: 'direct', label: t('Individuais') },
    { id: 'group', label: t('Grupos') },
  ];
  const searching = query.trim() !== '';

  return (
    <>
    {fab}
    <PullRefresh
      onRefresh={async () => {
        list.reload();
        await new Promise((resolve) => setTimeout(resolve, 700));
      }}
    >
    <div className={`convscreen${cameBack ? ' convscreen--back' : ''}`}>
      <PageHead title={t('Conversas')} />
      <Link to="/grupos" className={`convrequests groupslink${groupInvites > 0 ? ' convrequests--unread' : ''}`}>
        <span className="convrequests__icon" aria-hidden="true">
          <UsersIcon />
        </span>
        <span className="convrequests__text">
          <strong>{t('Grupos de amigos')}</strong>
          <span>{groupInvites > 0 ? (groupInvites === 1 ? t('1 convite para um grupo') : t('{count} convites para grupos', { count: groupInvites })) : t('Seus grupos, convites e eventos de cada grupo')}</span>
        </span>
        {groupInvites > 0 ? <span className="convrow__count">{groupInvites > 9 ? '9+' : groupInvites}</span> : null}
      </Link>
      {requestCount > 0 ? (
        <Link to="/conversas/solicitacoes" className={`convrequests${requestUnread > 0 ? ' convrequests--unread' : ''}`}>
          <span className="convrequests__icon" aria-hidden="true">
            <ChatIcon />
          </span>
          <span className="convrequests__text">
            <strong>{t('Solicitações de mensagem')}</strong>
            <span>{requestCount === 1 ? t('1 pessoa que você não segue quer conversar') : t('{count} pessoas que você não segue querem conversar', { count: requestCount })}</span>
          </span>
          {requestUnread > 0 ? (
            <span className="convrow__count" aria-label={requestUnread === 1 ? t('1 não lida') : t('{count} não lidas', { count: requestUnread })}>
              {requestUnread > 9 ? '9+' : requestUnread}
            </span>
          ) : null}
        </Link>
      ) : null}
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
          <div className="segtabs segtabs--fill convtabs" role="tablist" aria-label={t('Tipos de conversa')}>
            {tabs.map((x) => {
              const unread = unreadInTab(items, x.id);
              return (
                <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} className="segtabs__tab" onClick={() => chooseTab(x.id)}>
                  {x.label}
                  {unread > 0 ? (
                    <span className="segtabs__n" aria-label={unread === 1 ? t('1 conversa não lida') : t('{count} conversas não lidas', { count: unread })}>
                      {unread > 99 ? '99+' : unread}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          {shown.length === 0 && !searching && tab !== 'all' ? (
            <EmptyState title={tab === 'group' ? t('Nenhum grupo ainda') : t('Nenhuma conversa individual ainda')}>
              {tab === 'group' ? t('Toque em Nova conversa para criar um grupo com seus amigos.') : t('Escreva para um amigo pelo perfil dele ou toque em Nova conversa.')}
            </EmptyState>
          ) : shown.length === 0 ? (
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
                  <Link to={`/conversas/${c.id}`} className={`convrow${c.unread > 0 ? ' convrow--unread' : ''}${c.id === activeId ? ' convrow--active' : ''}`} aria-current={c.id === activeId ? 'page' : undefined}>
                    {c.venue?.role === 'CUSTOMER' ? <GroupAvatar name={c.venue.name} size={48} imageUrl={safeImage(c.venue.logoUrl)} /> : c.other ? <Avatar profile={c.other} size={48} /> : <GroupAvatar name={c.name ?? t('Grupo')} size={48} imageUrl={c.imageUrl} />}
                    <span className="convrow__body">
                      <span className="convrow__top">
                        <span className="convrow__name">
                          {c.venue?.role === 'CUSTOMER' ? c.venue.name : c.other ? c.other.displayName : (c.name ?? 'Grupo')}
                          {c.venue?.role === 'OWNER' ? <span className="convrow__via"> · {c.venue.name}</span> : null}
                        </span>
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
          remove={{ group: prefsFor.type === 'GROUP', community: prefsFor.community === true, left: prefsFor.left === true, onRemoved: () => list.reload() }}
        />
      ) : null}
    </div>
    </PullRefresh>
    </>
  );
}

/**
 * Solicitações de mensagem: conversas começadas por quem você não segue (como no Instagram). Abrir a conversa não
 * avisa a pessoa; lá dentro você aceita, recusa ou bloqueia.
 */
export function MessageRequestsScreen() {
  useTitle(t('Solicitações de mensagem'));
  const list = useAsync(() => api.messageRequests(), []);
  useLiveRefresh(list.reload, 10_000);
  const now = new Date();
  if (list.loading && !list.data) {
    return (
      <div className="convscreen">
        <PageHead title={t('Solicitações de mensagem')} back="/conversas" />
        <p className="muted convrequests__help">{t('Mensagens de quem você não segue. A pessoa só fica sabendo que você viu se você aceitar.')}</p>
        <Loading />
      </div>
    );
  }
  if (list.error && !list.data) return <ErrorState message={list.error.message} onRetry={list.reload} />;
  const items = list.data?.items ?? [];
  return (
    <div className="convscreen">
      <PageHead title={t('Solicitações de mensagem')} back="/conversas" />
      <p className="muted convrequests__help">{t('Mensagens de quem você não segue. A pessoa só fica sabendo que você viu se você aceitar.')}</p>
      {items.length === 0 ? (
        <EmptyState title={t('Nenhuma solicitação')}>{t('Quando alguém que você não segue mandar mensagem, ela aparece aqui.')}</EmptyState>
      ) : (
        <ul className="list convlist">
          {items.map((c) => (
            <li key={c.id} className="convitem">
              <Link to={`/conversas/${c.id}`} className={`convrow${c.unread > 0 ? ' convrow--unread' : ''}`}>
                {c.other ? <Avatar profile={c.other} size={48} /> : null}
                <span className="convrow__body">
                  <span className="convrow__top">
                    <span className="convrow__name">{c.other?.displayName ?? ''}</span>
                    {c.lastMessage ? <span className="convrow__time">{listTimeLabel(c.lastMessage.createdAt, now)}</span> : null}
                  </span>
                  <span className="convrow__preview">{previewOf(c.lastMessage)}</span>
                </span>
                {c.unread > 0 ? (
                  <span className="convrow__count" aria-label={c.unread === 1 ? t('1 não lida') : t('{count} não lidas', { count: c.unread })}>
                    {c.unread > 9 ? '9+' : c.unread}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Barra no lugar da caixa de texto quando a conversa é uma solicitação recebida: aceitar, recusar ou bloquear. */
function MessageRequestBar({ conversationId, other, onAccepted }: { conversationId: string; other: PublicProfile; onAccepted: () => void }) {
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();

  async function attempt(action: () => Promise<unknown>, after: () => void) {
    setProblem(undefined);
    try {
      await action();
      announceChatsChanged();
      after();
    } catch (failure) {
      setProblem(toApiError(failure).message);
    }
  }

  async function block() {
    setBlocking(true);
    await attempt(
      async () => {
        await api.declineMessageRequest(conversationId);
        await api.block(other.userId);
      },
      () => navigate('/conversas/solicitacoes', { replace: true }),
    );
    setBlocking(false);
  }

  return (
    <div className="chat__request" role="group" aria-label={t('Solicitação de mensagem')}>
      <p className="chat__requesttext">
        <strong>{t('{name} quer mandar mensagem para você', { name: other.displayName })}</strong>
        <span>{t('Você não segue @{username}. A pessoa só fica sabendo que você viu se você aceitar. Recusar não avisa ninguém.', { username: other.username })}</span>
      </p>
      {problem ? <Notice tone="error">{problem}</Notice> : null}
      {confirmBlock ? (
        <Confirm
          question={t('Bloquear @{username}? A pessoa não consegue mais mandar mensagem nem ver seu perfil.', { username: other.username })}
          confirmLabel={t('Bloquear')}
          danger
          busy={blocking}
          onConfirm={() => void block()}
          onCancel={() => setConfirmBlock(false)}
        />
      ) : (
        <div className="chat__requestactions">
          <Button variant="secondary" small onClick={() => setConfirmBlock(true)}>
            {t('Bloquear')}
          </Button>
          <Button variant="secondary" small onClick={() => attempt(() => api.declineMessageRequest(conversationId), () => navigate('/conversas/solicitacoes', { replace: true }))}>
            {t('Recusar')}
          </Button>
          <Button small onClick={() => attempt(() => api.acceptMessageRequest(conversationId), onAccepted)}>
            {t('Aceitar')}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Rota das conversas. No celular é uma tela por vez (lista ou chat); no computador largo, a lista fica à esquerda
 * e a conversa aberta à direita, como nos apps de mensagem de desktop.
 */
export function ConversationsRoute({ conversationId }: { conversationId?: string }) {
  const wide = useWideDesktop();
  if (!wide) return conversationId ? <ChatScreen key={conversationId} conversationId={conversationId} /> : <ConversationsScreen />;
  return (
    <div className="convsplit">
      <div className="convsplit__list">
        <ConversationsScreen split activeId={conversationId} />
      </div>
      <section className="convsplit__chat" aria-label={t('Conversa')}>
        {conversationId ? (
          <ChatScreen key={conversationId} conversationId={conversationId} />
        ) : (
          <div className="convsplit__empty">
            <span className="convsplit__icon" aria-hidden="true">
              <ChatIcon />
            </span>
            <h2 className="convsplit__title">{t('Suas conversas')}</h2>
            <p className="muted">{t('Escolha uma conversa na lista para abrir aqui, ou comece uma nova.')}</p>
          </div>
        )}
      </section>
    </div>
  );
}

/** Larguras do nome e da prévia de cada linha falsa, para não parecer uma grade igual. */
const SKELETON_ROWS: Array<[name: number, preview: number]> = [
  [46, 78],
  [34, 62],
  [52, 70],
  [40, 56],
  [30, 74],
  [44, 64],
];

/**
 * Enquanto a lista carrega: o mesmo cabeçalho, a mesma busca e as mesmas linhas (avatar, nome, hora, prévia e o
 * botão de opções), usando as classes reais, para nada pular de lugar quando as conversas chegam.
 */
function ConversationsSkeleton() {
  return (
    <div className="convscreen" role="status" aria-live="polite">
      <PageHead title={t('Conversas')} />
      <span className="visually-hidden">{t('Carregando conversas…')}</span>
      <div aria-hidden="true">
        <div className="search search--convs">
          <span className="convskel convskel--search" />
        </div>
        <ul className="list convlist">
          {SKELETON_ROWS.map(([name, preview], i) => (
            <li key={i} className="convitem">
              <span className="convrow">
                <span className="convskel convskel--avatar" />
                <span className="convrow__body">
                  <span className="convrow__top">
                    <span className="convrow__name">
                      <span className="convskel convskel--text" style={{ width: `${name * 2.4}px` }} />
                    </span>
                    <span className="convrow__time">
                      <span className="convskel convskel--text convskel--time" />
                    </span>
                  </span>
                  <span className="convrow__preview">
                    <span className="convskel convskel--text" style={{ width: `${preview}%` }} />
                  </span>
                </span>
              </span>
              <span className="iconbtn convitem__more" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ---------- Conversa ----------

/** Balões falsos do esqueleto do chat: de quem é, a largura (em %) e quantas linhas de texto. */
const CHAT_SKELETON: Array<{ mine: boolean; width: number; lines?: number; pos: RunPosition }> = [
  { mine: false, width: 58, pos: 'first' },
  { mine: false, width: 72, lines: 2, pos: 'last' },
  { mine: true, width: 44, pos: 'first' },
  { mine: true, width: 64, lines: 2, pos: 'last' },
  { mine: false, width: 36, pos: 'single' },
  { mine: true, width: 52, pos: 'single' },
  { mine: false, width: 66, lines: 2, pos: 'first' },
  { mine: false, width: 40, pos: 'last' },
];

/**
 * Enquanto a conversa carrega: o mesmo topo (voltar, foto, nome e opções), balões dos dois lados encostados embaixo
 * (a conversa abre no fim) e a caixa de mensagem, com as classes reais para nada pular quando as mensagens chegam.
 * Antes aparecia o esqueleto genérico de lista (linhas com foto e texto), que não tem nada a ver com um chat.
 */
function ChatSkeleton() {
  return (
    <div className="chat chat--enter chat--pinned chatskel" role="status" aria-live="polite">
      <span className="visually-hidden">{t('Carregando conversa…')}</span>
      <header className="chathead">
        <Link to="/conversas" className="pagehead__back" aria-label={t('Voltar')}>
          <ChevronLeftIcon />
        </Link>
        <span className="chathead__who" aria-hidden="true">
          <span className="convskel chatskel__avatar" />
          <span className="chathead__text">
            <span className="chathead__name">
              <span className="convskel convskel--text chatskel__name" />
            </span>
            <span className="chathead__sub">
              <span className="convskel convskel--text chatskel__sub" />
            </span>
          </span>
        </span>
        <span className="iconbtn chathead__more" aria-hidden="true" />
      </header>
      <div className="chat__thread chatskel__thread" aria-hidden="true">
        {CHAT_SKELETON.map((b, i) => (
          <div key={i} className={`msg${b.mine ? ' msg--mine' : ''} msg--run-${b.pos}${b.pos === 'first' || b.pos === 'single' ? ' chatskel__runstart' : ''}`}>
            {!b.mine ? <span className="msg__face">{b.pos === 'last' || b.pos === 'single' ? <span className="convskel chatskel__face" /> : null}</span> : null}
            <span className={`bubble chatskel__bubble${b.mine ? ' chatskel__bubble--mine' : ''}`} style={{ width: `${b.width}%` }}>
              {Array.from({ length: b.lines ?? 1 }, (_, l) => (
                <span key={l} className="convskel convskel--text chatskel__line" style={l > 0 ? { width: '60%' } : undefined} />
              ))}
            </span>
          </div>
        ))}
      </div>
      <div className="chat__dock" aria-hidden="true">
        <div className="composer">
          <span className="convskel chatskel__pill" />
        </div>
      </div>
    </div>
  );
}

const POLL_MS = 5_000;
/** Quantas fotos ou vídeos dá para mandar de uma vez. */
const STAGED_MAX = 10;

interface StagedMedia {
  id: string;
  file: File;
  kind: 'IMAGE' | 'VIDEO';
  url: string;
}

/**
 * Story respondido, em cima da resposta, só enquanto ainda está no ar (quando acaba, some da conversa).
 * Tocar abre o story. Quem recebeu a resposta vê a miniatura grande, centralizada; quem respondeu vê uma faixa
 * compacta, "Você respondeu ao story de @fulana", com a miniatura pequena ao lado.
 */
function StoryAttachment({ story, mine }: { story: MessageStory; mine: boolean }) {
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  if (failed) return null;
  const src = api.storyMediaUrl(story.id);
  const thumb =
    story.kind === 'VIDEO' ? (
      <video src={src} muted playsInline preload="metadata" onError={() => setFailed(true)} />
    ) : (
      <img src={src} alt="" draggable={false} onError={() => setFailed(true)} />
    );
  const label = mine ? t('Você respondeu ao flash de @{username}', { username: story.author.username }) : t('Respondeu ao seu flash');
  return (
    <>
      <button
        type="button"
        className={`bubble__story${mine ? ' bubble__story--sent' : ''}`}
        aria-label={t('{label}. Abrir o flash', { label })}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <span className="bubble__storythumb">{thumb}</span>
        <span className="bubble__storylabel">{label}</span>
      </button>
      {open
        ? createPortal(
        <StoryViewer
          groups={[{ author: story.author, mine: !mine, items: [{ id: story.id, kind: story.kind, caption: story.caption, captionY: story.captionY, createdAt: story.createdAt, expiresAt: story.expiresAt, canDelete: false, ...(story.overlays ? { overlays: story.overlays } : {}) }] }]}
          start={{ group: 0, item: 0 }}
          onClose={() => setOpen(false)}
          onChanged={() => setOpen(false)}
        />,
          document.body,
        )
        : null}
    </>
  );
}

export function ChatScreen({ conversationId }: { conversationId: string }) {
  useEffect(() => () => void (chatLeftAt = Date.now()), []);
  const view = useAsync(() => api.messages(conversationId), [conversationId]);
  useLiveRefresh(view.reload, POLL_MS);
  const flash = useAsync(() => api.flashInvites(), [conversationId]);
  usePolling(flash.reload, 10_000);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [older, setOlder] = useState<{ hasMore: boolean; loading: boolean }>({ hasMore: false, loading: false });
  const [draft, setDraft] = useState(() => readDraft(conversationId));
  const [sending, setSending] = useState(false);
  /** Conta os envios: a cada um, a bandeja de emojis do campo fecha. */
  const [sentCount, setSentCount] = useState(0);
  /** Gravando áudio: `hold` enquanto segura o microfone, `locked` gravando sem segurar (travou ou clicou). */
  const [recording, setRecording] = useState<false | 'hold' | 'locked'>(false);
  const voiceControl = useRef<VoiceControl | undefined>(undefined);
  const [voiceSlide, setVoiceSlide] = useState({ dx: 0, dy: 0 });
  const [micHint, setMicHint] = useState(false);
  const lastTouchAt = useRef(0);
  useEffect(() => {
    if (!micHint) return undefined;
    const timer = window.setTimeout(() => setMicHint(false), 2200);
    return () => window.clearTimeout(timer);
  }, [micHint]);

  /**
   * Segurar o microfone grava (como no WhatsApp): soltar envia, arrastar para a esquerda cancela e para cima trava.
   * Toque rápido só mostra a dica. Com mouse, o clique grava no modo travado (onClick).
   */
  function holdMic(e: ReactPointerEvent<HTMLButtonElement>) {
    if (e.pointerType === 'mouse' || recording) return;
    e.preventDefault();
    lastTouchAt.current = Date.now();
    const start = { x: e.clientX, y: e.clientY, at: Date.now(), id: e.pointerId };
    setProblem(undefined);
    setMicHint(false);
    setVoiceSlide({ dx: 0, dy: 0 });
    setRecording('hold');
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== start.id) return;
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      setVoiceSlide({ dx, dy });
      if (dx < VOICE_CANCEL_DX) {
        stop();
        haptic('tap');
        voiceControl.current?.finish(false);
      } else if (dy < VOICE_LOCK_DY) {
        stop();
        haptic('tick');
        setRecording('locked');
      }
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== start.id) return;
      stop();
      lastTouchAt.current = Date.now();
      // Toque rápido: não grava nada, só ensina o gesto.
      if (Date.now() - start.at < 350) {
        voiceControl.current?.finish(false);
        setRecording(false);
        setMicHint(true);
        return;
      }
      voiceControl.current?.finish(true);
    };
    const cancel = (ev: PointerEvent) => {
      if (ev.pointerId !== start.id) return;
      stop();
      voiceControl.current?.finish(false);
      setRecording(false);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  }
  const [problem, setProblem] = useState<string | undefined>();
  // Mapa dos locais entre vocês, aberto dentro do chat. `search` já abre a busca de outro lugar (vindo da página do NOW).
  /** Mapa em modal: você, o amigo e o local (`place` vazio = o local combinado). */
  const [mapFor, setMapFor] = useState<{ place?: { name: string; lat: number; lng: number } } | undefined>();
  const [suggesting, setSuggesting] = useState<'suggest' | 'search' | undefined>(() => {
    const ask = new URLSearchParams(window.location.search).get('sugerir');
    return ask === 'outro' ? 'search' : ask !== null ? 'suggest' : undefined;
  });
  useEffect(() => {
    // O pedido vem na URL só uma vez: tira para que voltar ou recarregar não abra o mapa de novo.
    if (!new URLSearchParams(window.location.search).has('sugerir')) return;
    window.history.replaceState(window.history.state, '', window.location.pathname);
  }, []);
  const [replyTo, setReplyTo] = useState<ChatMessage | undefined>();
  const background = useChatBackground(conversationId);
  /** Cor escolhida agora há pouco: aparece na hora, antes de a conversa recarregar do servidor. */
  const [pickedColor, setPickedColor] = useState<string | null | undefined>();
  const [actionsFor, setActionsFor] = useState<ChatMessage | undefined>();
  const [reactionsFor, setReactionsFor] = useState<ChatMessage | undefined>();
  const [burst, setBurst] = useState<string | undefined>();
  const lastTap = useRef<{ id: string; at: number; x: number; y: number } | undefined>(undefined);
  const threadRef = useRef<HTMLDivElement>(null);
  const reveal = useTimeReveal(threadRef);
  const [uploading, setUploading] = useState(false);
  /** Otimizando um vídeo antes de enviar (0 a 1). */
  const [prep, setPrep] = useState<number | undefined>();
  const [selected, setSelected] = useState<string[] | undefined>();
  const [deleting, setDeleting] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string[] | undefined>();
  const deleteTimer = useRef<number | undefined>(undefined);
  const deleteIds = useRef<string[] | undefined>(undefined);
  const galleryRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [staged, setStaged] = useState<StagedMedia[]>([]);
  /** Foto da prévia aberta no editor (girar, recortar, desenhar, escrever). */
  const [editingId, setEditingId] = useState<string | undefined>();
  /** GIF escolhido, ainda não enviado: aparece acima do campo até tocar em enviar. */
  const [pendingGif, setPendingGif] = useState<CommentGif | undefined>();
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
  /** Primeira mensagem não lida ao abrir: a divisória "Mensagens novas" vem antes dela. */
  const [unreadFrom, setUnreadFrom] = useState<string | undefined>();
  const jumpToUnread = useRef(false);
  /** Longe do fim (rolou para cima): aparece o botão para voltar à última mensagem. */
  const [far, setFar] = useState(false);
  /** Mensagem destacada por um instante (tocou na citação de uma resposta). */
  const [flashId, setFlashId] = useState<string | undefined>();
  /** Dia das mensagens no topo da tela, flutuando enquanto rola. */
  const [dayPill, setDayPill] = useState<string | undefined>();

  const chatName = view.data ? (view.data.other ? view.data.other.displayName : (view.data.name ?? t('Grupo'))) : 'Conversa';
  useTitle(chatName);

  useEffect(() => {
    loadedFirst.current = false;
    setMessages([]);
    setReplyTo(undefined);
    setPickedColor(undefined);
    setActionsFor(undefined);
    setSelected(undefined);
    setDeleting(false);
    setUnseen(0);
    setUnreadFrom(undefined);
    setFar(false);
    setFlashId(undefined);
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

  // Esc cancela a resposta (no computador), se não houver seleção aberta.
  useEffect(() => {
    if (!replyTo || selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setReplyTo(undefined);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [replyTo, selected]);

  // Abriu com muitas mensagens novas: leva até a divisória.
  useLayoutEffect(() => {
    if (!jumpToUnread.current || !unreadFrom) return;
    const el = document.getElementById('chat-unread');
    if (!el) return;
    jumpToUnread.current = false;
    el.scrollIntoView({ block: 'center' });
  }, [unreadFrom, messages.length]);

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
      const list = view.data.messages;
      const from = firstUnreadId(list, view.data.myReadAt);
      setUnreadFrom(from);
      // Muitas mensagens novas: abre na divisória (para ler do começo), não no fim.
      const index = from ? list.findIndex((m) => m.id === from) : -1;
      if (index !== -1 && list.length - index > 6) {
        stickToEnd.current = false;
        jumpToUnread.current = true;
      }
    }
  }, [view.data]);

  // A página inteira rola; só acompanha as mensagens novas se a pessoa já estiver perto do fim.
  // Chegar ao fim rolando (ou tentar passar dele) acende uma luzinha em cima da caixa de mensagem, como nos outros apps.
  const [glow, setGlow] = useState(0);
  useEffect(() => {
    const gapToEnd = () => document.documentElement.scrollHeight - window.scrollY - window.innerHeight;
    let atEnd = gapToEnd() < 2;
    let userAt = 0;
    let glowAt = 0;
    let touchY: number | undefined;
    const light = () => {
      const now = performance.now();
      if (now - glowAt < 900) return;
      glowAt = now;
      setGlow((n) => n + 1);
    };
    let pillTimer: number | undefined;
    const showPill = () => {
      // Dia da primeira mensagem visível logo abaixo do topo fixo da conversa.
      const top = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--chat-top')) || 72;
      const items = document.querySelectorAll<HTMLElement>('.chat__item[data-at]');
      let at: string | undefined;
      for (const item of items) {
        if (item.getBoundingClientRect().bottom > top + 8) {
          at = item.dataset['at'];
          break;
        }
      }
      setDayPill(at ? dayPillLabel(at, new Date()) : undefined);
      window.clearTimeout(pillTimer);
      pillTimer = window.setTimeout(() => setDayPill(undefined), 1200);
    };
    const onScroll = () => {
      const gap = gapToEnd();
      setFar(gap > 700);
      if (performance.now() - userAt < 1200) showPill();
      stickToEnd.current = gap < 120;
      if (stickToEnd.current) setUnseen(0);
      const nowAtEnd = gap < 2;
      // Só quando foi a pessoa que rolou (não a rolagem automática de mensagem nova ou ao abrir a conversa).
      if (nowAtEnd && !atEnd && performance.now() - userAt < 1200) light();
      atEnd = nowAtEnd;
    };
    const onTouchStart = (e: TouchEvent) => {
      userAt = performance.now();
      touchY = e.touches[0]?.clientY;
    };
    const onTouchMove = (e: TouchEvent) => {
      userAt = performance.now();
      const y = e.touches[0]?.clientY;
      // Já no fim e o dedo ainda subindo (querendo ver mais embaixo): acende de novo.
      if (y !== undefined && touchY !== undefined && touchY - y > 24 && gapToEnd() < 2) {
        light();
        touchY = y;
      }
    };
    const onWheel = (e: WheelEvent) => {
      userAt = performance.now();
      if (e.deltaY > 0 && gapToEnd() < 2) light();
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      window.clearTimeout(pillTimer);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('wheel', onWheel);
    };
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

  // No celular o topo (nome do amigo) e a caixa de mensagem ficam presos na tela (position: fixed, ver .chat--pinned
  // no CSS). A conversa precisa de um espaço do tamanho deles em cima e embaixo, senão as mensagens passam por baixo:
  // mede os dois sempre que mudam de altura (resposta, fotos na fila, modo seleção) e guarda em --chat-top/--chat-bottom.
  const chatRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = chatRef.current;
    if (!root || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const top = root.querySelector<HTMLElement>(':scope > .chathead, :scope > .selectbar');
      const bottom = root.querySelector<HTMLElement>(':scope > .chat__dock, :scope > .selectactions');
      root.style.setProperty('--chat-top', `${top?.offsetHeight ?? 0}px`);
      root.style.setProperty('--chat-bottom', `${bottom?.offsetHeight ?? 0}px`);
    };
    const sizes = new ResizeObserver(measure);
    const watch = () => {
      sizes.disconnect();
      root.querySelectorAll<HTMLElement>(':scope > .chathead, :scope > .selectbar, :scope > .chat__dock, :scope > .selectactions').forEach((el) => sizes.observe(el));
      measure();
    };
    const children = new MutationObserver(watch);
    children.observe(root, { childList: true });
    watch();
    return () => {
      sizes.disconnect();
      children.disconnect();
    };
  }, [hasThread]);

  // Teclado aberto (iPhone): o sistema não encolhe a página, só a parte visível, e empurra a página para cima para
  // mostrar a caixa de texto; o topo preso (position: fixed) sumia acima da tela. Como no WhatsApp, o topo acompanha
  // a parte visível (--chat-vv-top) e a caixa de mensagem fica logo acima do teclado (--chat-kb). Sem teclado, os dois são 0.
  useEffect(() => {
    const root = chatRef.current;
    const vv = window.visualViewport;
    if (!root || !vv) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const top = Math.max(0, vv.offsetTop);
        const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
        root.style.setProperty('--chat-vv-top', `${Math.round(top)}px`);
        root.style.setProperty('--chat-kb', `${Math.round(kb)}px`);
      });
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    update();
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [hasThread]);

  if (view.loading && !view.data && !view.error) return <ChatSkeleton />;
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
  const color = pickedColor !== undefined ? pickedColor : (data.color ?? null);
  const colorStyle = chatColorStyle(color);
  const match = data.other ? flash.data?.matches.find((m) => m.other.userId === data.other?.userId) : undefined;
  const serverNow = Date.parse(data.now);

  /**
   * Ctrl+C com o mouse selecionando mais de uma mensagem: copia com a hora e o nome de quem mandou cada uma
   * ("[14:02] Bia: oi"), como no WhatsApp Web. Dentro de uma mensagem só, copia o trecho selecionado, como sempre.
   */
  function copySelection(e: ReactClipboardEvent<HTMLDivElement>) {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const ids = messages.filter((m) => {
      const el = document.getElementById(`msg-${m.id}`);
      return el ? sel.containsNode(el, true) : false;
    });
    if (ids.length < 2) return;
    const text = copyText(ids, data?.other?.displayName);
    if (text === '') return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', text);
  }

  /** Responder: marca a mensagem e já abre o teclado no campo. */
  function startReply(m: ChatMessage) {
    setReplyTo(m);
    window.requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  }

  /** Vai até a mensagem citada (carregando as anteriores, se preciso) e a destaca por um instante. */
  async function jumpTo(id: string) {
    let list = messages;
    let hasMore = older.hasMore;
    try {
      for (let tries = 0; !list.some((m) => m.id === id) && hasMore && tries < 8; tries += 1) {
        const first = list[0];
        if (!first) break;
        const page = await api.messages(conversationId, { before: first.createdAt });
        list = mergeMessages(page.messages, list);
        hasMore = page.hasMore;
      }
    } catch (failure) {
      setProblem(toApiError(failure).message);
      return;
    }
    if (list !== messages) {
      stickToEnd.current = false;
      const loaded = list;
      setMessages((current) => mergeMessages(loaded, current));
      setOlder({ hasMore, loading: false });
    }
    if (!list.some((m) => m.id === id)) {
      setProblem(t('Essa mensagem é antiga demais para mostrar aqui.'));
      return;
    }
    stickToEnd.current = false;
    setFlashId(id);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => document.getElementById(`msg-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })));
    window.setTimeout(() => setFlashId((current) => (current === id ? undefined : current)), 1800);
  }

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
  async function pickMedia(event: ChangeEvent<HTMLInputElement>) {
    // Tipo corrigido pela extensão: alguns aparelhos entregam o vídeo sem tipo e o servidor recusava.
    const files = Array.from(event.target.files ?? []).map(withMediaType);
    event.target.value = '';
    if (files.length === 0) return;
    setProblem(undefined);
    const room = STAGED_MAX - staged.length;
    const ok: StagedMedia[] = [];
    // Vídeo grande serve se o aparelho conseguir reduzir antes de enviar (como nos posts).
    const canCompress = files.some((f) => mediaKind(f) === 'VIDEO' && f.size > CHAT_VIDEO_MAX_BYTES) ? await canCompressVideo() : false;
    for (const file of files) {
      const trouble = mediaProblem(file, { canCompress });
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

  /** Documento (PDF, Word...): sai na hora, um por vez, respondendo à mensagem marcada. */
  async function pickFile(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;
    setProblem(undefined);
    let reply = replyTo?.id;
    setSending(true);
    setUploading(true);
    try {
      for (const file of files) {
        const trouble = fileProblem(file);
        if (trouble) {
          setProblem(trouble);
          continue;
        }
        const message = await api.sendFile(conversationId, file, file.name, documentType(file.name, file.type) ?? file.type, reply);
        reply = undefined;
        stickToEnd.current = true;
        setMessages((current) => mergeMessages(current, [message]));
      }
      setReplyTo(undefined);
    } catch (failure) {
      setProblem(toApiError(failure).message);
    } finally {
      setSending(false);
      setUploading(false);
    }
  }

  /** A foto editada substitui a original na prévia, no mesmo lugar. */
  function applyEdit(id: string, file: File) {
    setEditingId(undefined);
    setStaged((current) =>
      current.map((x) => {
        if (x.id !== id || x.file === file) return x;
        URL.revokeObjectURL(x.url);
        return { ...x, file, url: URL.createObjectURL(file) };
      }),
    );
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
        pressTimer.current = window.setTimeout(() => setActionsFor(m), LONG_PRESS_MS);
      },
      onTouchEnd: () => window.clearTimeout(pressTimer.current),
      onTouchMove: () => window.clearTimeout(pressTimer.current),
    };
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    const media = staged;
    const gif = pendingGif;
    if ((text === '' && media.length === 0 && !gif) || sending) return;
    // Enviou: a bandeja de emojis fecha, como no Instagram.
    setSentCount((n) => n + 1);
    // Como no Instagram: o campo esvazia na hora e o teclado continua aberto para a próxima mensagem.
    // Se o envio falhar, o texto volta para o campo.
    if (text !== '') setDraft('');
    setSending(true);
    setUploading(media.length > 0);
    setProblem(undefined);
    let reply = replyTo?.id;
    try {
      // Primeiro as fotos (na ordem escolhida), depois o GIF, depois o texto, logo abaixo.
      for (const item of media) {
        let blob: Blob;
        if (item.kind === 'IMAGE') blob = await prepareImage(item.file);
        else {
          setPrep(0);
          blob = await prepareVideoUpload(item.file, (fraction) => setPrep(fraction));
          setPrep(undefined);
        }
        const message = await api.sendMedia(conversationId, blob, reply);
        reply = undefined;
        stickToEnd.current = true;
        setMessages((current) => mergeMessages(current, [message]));
        unstage(item.id);
      }
      setUploading(false);
      if (gif) {
        const message = await api.sendGif(conversationId, gif, reply);
        reply = undefined;
        stickToEnd.current = true;
        setMessages((current) => mergeMessages(current, [message]));
        setPendingGif(undefined);
      }
      if (text !== '') {
        const message = await api.sendText(conversationId, text, reply);
        stickToEnd.current = true;
        setMessages((current) => mergeMessages(current, [message]));
        typingSentAt.current = 0;
      }
      setReplyTo(undefined);
    } catch (failure) {
      if (text !== '') setDraft((current) => (current === '' ? text : current));
      if (reply === undefined) setReplyTo(undefined);
      setProblem(failure instanceof Error && failure.message === 'grande' ? t('Não consegui reduzir a foto para o tamanho permitido.') : failure instanceof Error && !(failure instanceof ApiError) && failure.message ? failure.message : toApiError(failure).message);
    } finally {
      setSending(false);
      setUploading(false);
      setPrep(undefined);
    }
  }

  // Depois que um local foi aceito, o botão passa a ser para trocar o local (o aceite pode ser cancelado no cartão).
  // Só um local aceito por vez: o mais recente com aceite.
  const agreedMessage = [...messages].reverse().find((m) => m.kind === 'SUGGESTION' && !m.deleted && m.response === 'ACCEPTED' && m.suggestion);
  const agreed = agreedMessage?.suggestion ? { id: agreedMessage.id, name: agreedMessage.suggestion.venueName, lat: agreedMessage.suggestion.lat, lng: agreedMessage.suggestion.lng } : undefined;
  const placeAgreed = agreed !== undefined;
  // Encontro do NOW fixado no topo da conversa (tempo, local e localizações); tocar abre o encontro.
  const matchPin = match ? (
    <MatchPin
      inviteId={match.id}
      otherName={data.other?.displayName ?? ''}
      agreedName={agreed?.name}
      onSuggest={() => setSuggesting('suggest')}
      onMap={() => setMapFor(agreed ? { place: { name: agreed.name, lat: agreed.lat, lng: agreed.lng } } : {})}
    />
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
    const text = copyText(chosen, data?.other?.displayName);
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
  const gallery = galleryOf(visible);
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
    // Arrastar para selecionar texto (computador) não conta como toque na mensagem.
    if (window.getSelection()?.isCollapsed === false) return;
    registerTap(m, e.clientX, e.clientY);
  }

  const row = (m: ChatMessage, pos: RunPosition, cell: boolean) => (
    <SwipeRow key={m.id} className={`msg${m.mine ? ' msg--mine' : ''} msg--run-${pos}${cell ? ' msg--cell' : ''}${selected ? ' msg--selecting' : ''}${selected?.includes(m.id) ? ' msg--selected' : ''}${flashId === m.id ? ' msg--flash' : ''}`} id={`msg-${m.id}`} enabled={data.canSend && hasActions(m) && !selected} onReply={() => startReply(m)}>
      {selected && hasActions(m) ? (
        <button type="button" className="msg__pick" role="checkbox" aria-checked={selected.includes(m.id)} aria-label={t('Selecionar mensagem de {name}, {time}', { name: m.mine ? t('você') : (m.senderName ?? t('contato')), time: formatClock(m.createdAt) })} onClick={() => toggleChosen(m.id)}>
          <span className={`msg__check${selected.includes(m.id) ? ' is-on' : ''}`} aria-hidden="true">{selected.includes(m.id) ? <CheckIcon /> : null}</span>
        </button>
      ) : null}
      {!cell && !m.mine ? <span className="msg__face">{pos === 'last' || pos === 'single' ? face(m.senderId) : null}</span> : null}
      {!cell && !selected && m.mine && hasActions(m) ? moreButton(m) : null}
      <div className={`bubble${m.mine ? ' bubble--mine' : ''}${m.reactions.length > 0 ? ' bubble--reacted' : ''}${m.deleted ? ' bubble--deleted' : m.kind === 'AUDIO' ? ' bubble--voice' : m.kind === 'IMAGE' || m.kind === 'VIDEO' ? ' bubble--media' : m.kind !== 'TEXT' || m.sharedProfile ? ' bubble--card' : ''}`} title={formatClock(m.createdAt)} onClick={(e) => tapBubble(m, e)} {...pressHandlers(m)}>
        {isGroup && !m.mine && m.senderName && (pos === 'first' || pos === 'single') ? <span className="bubble__sender">{m.senderName}</span> : null}
        {m.story && !m.deleted ? <StoryAttachment story={m.story} mine={m.mine} /> : null}
        {m.replyTo && !m.deleted ? (
          <button type="button" className="bubble__quote" aria-label={t('Ir para a mensagem respondida de {name}', { name: m.replyTo.mine ? t('você') : (m.replyTo.senderName ?? '') })} onClick={() => void jumpTo(m.replyTo!.id)}>
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
          <SuggestionBubble message={m} otherName={data.other.displayName} nowIso={data.now} conversationId={conversationId} onUpdated={(updated) =>
              setMessages((current) =>
                // Aceitar um local cancela o aceite do anterior (o servidor já fez; aqui aparece na hora).
                mergeMessages(updated.response === 'ACCEPTED' ? current.map((x) => (x.id !== updated.id && x.kind === 'SUGGESTION' && x.response === 'ACCEPTED' ? { ...x, response: null, respondedAt: null } : x)) : current, [updated]),
              )
            } onOpenMap={(place) => setMapFor({ place })} agreed={agreed} onSuggestOther={match ? () => setSuggesting('suggest') : undefined} />
        ) : m.kind === 'MEETUP' && m.meetup ? (
          <MeetupBubble meetup={m.meetup} nowIso={data.now} onUpdated={(updated) => setMessages((current) => current.map((x) => (x.id === m.id || x.meetup?.id === updated.id ? { ...x, meetup: updated } : x)))} />
        ) : m.kind === 'AUDIO' && m.audio ? (
          <VoiceBubble message={m} conversationId={conversationId} />
        ) : m.kind === 'IMAGE' || m.kind === 'VIDEO' ? (
          <MediaBubble message={m} conversationId={conversationId} onTap={(x, y) => registerTap(m, x, y)} gallery={gallery} />
        ) : m.kind === 'FILE' ? (
          <FileBubble message={m} conversationId={conversationId} />
        ) : m.kind === 'EVENT' && m.event ? (
          <EventBubble event={m.event} />
        ) : m.sharedProfile ? (
          <ProfileBubble card={m.sharedProfile} />
        ) : m.gif ? (
          <CommentGifView gif={m.gif} />
        ) : m.kind === 'TEXT' && m.venue ? (
          // Texto com link da página de um local: o texto e, embaixo, o cartão do local (abre a página no app).
          <>
            <p className="bubble__text"><LinkedText text={m.body} /></p>
            <VenueBubble venue={m.venue} />
          </>
        ) : m.kind === 'TEXT' && m.event ? (
          // Texto com link de evento: o texto e, embaixo, o cartão do evento (foto, título e link).
          <>
            <p className="bubble__text"><LinkedText text={m.body} /></p>
            <EventBubble event={m.event} />
          </>
        ) : (
          <p className="bubble__text"><LinkedText text={m.body} /></p>
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
    <div ref={chatRef} className={`chat chat--enter chat--pinned${background ? ' chat--bg' : ''}${colorStyle ? ' chat--colored' : ''}`} style={background || colorStyle ? ({ ...colorStyle, ...(background ? { '--chat-bg': `url(${background})` } : {}) } as CSSProperties) : undefined}>
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
        below={
          <>
            {matchPin}
            <PollLine conversationId={conversationId} />
          </>
        }
        pinned={data.pinned}
        muted={data.muted}
        onPrefsChanged={view.reload}
        color={color}
        onColorChange={setPickedColor}
        venue={data.venue ?? null}
        subtitle={isGroup ? `${peopleLabel(data.memberCount)} · toque para ver o grupo` : data.venue?.role === 'CUSTOMER' ? t('Página do local') : data.venue?.role === 'OWNER' && data.other ? t('@{username} · mensagem para {venue}', { username: data.other.username, venue: data.venue.name }) : data.other ? `@${data.other.username}` : undefined}
        onCleared={() => {
          setMessages([]);
          setOlder({ hasMore: false, loading: false });
          view.reload();
        }}
      />
      )}

      <div ref={threadRef} className="chat__thread" aria-live="polite" {...reveal} onCopy={copySelection}>
        {older.hasMore ? (
          <div className="chat__older">
            <Button small variant="quiet" loading={older.loading} onClick={loadOlder}>
              {t('Ver mensagens anteriores')}
            </Button>
          </div>
        ) : null}
        {messages.length === 0 ? <p className="muted chat__empty">{data.other ? t('Nenhuma mensagem ainda. Diga oi para {name}.', { name: data.other.displayName }) : t('Nenhuma mensagem ainda. Diga oi para o grupo.')}</p> : null}
        {(() => {
          let prev: ChatMessage | undefined;
          const unreadLine = (group: readonly ChatMessage[]) =>
            unreadFrom && group.some((m) => m.id === unreadFrom) ? (
              <p className="chat__unread" id="chat-unread">
                <span>{t('Mensagens novas')}</span>
              </p>
            ) : null;
          return albums.map((group) => {
            const first = group[0] as ChatMessage;
            const last = group[group.length - 1] as ChatMessage;
            const showBreak = timeBreak(prev, first);
            prev = last;
            if (first.kind === 'SYSTEM') {
              return (
                <div key={first.id} className="chat__item" data-at={first.createdAt}>
                  {showBreak ? <p className="chat__day">{breakLabel(first.createdAt, new Date(serverNow))}</p> : null}
                  <p className="chat__system">{first.body}</p>
                </div>
              );
            }
            const pos = posOf.get(last.id) ?? 'single';
            if (group.length === 1) {
              return (
                <div key={first.id} className={`chat__item chat__item--${pos}`} data-at={first.createdAt}>
                  {unreadLine(group)}
                  {showBreak ? <p className="chat__day">{breakLabel(first.createdAt, new Date(serverNow))}</p> : null}
                  {row(first, posOf.get(first.id) ?? 'single', false)}
                </div>
              );
            }
            return (
              <div key={first.id} className={`chat__item chat__item--${pos}`} data-at={first.createdAt}>
                {unreadLine(group)}
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

      {dayPill ? (
        <p className="chat__daypill" aria-hidden="true">
          {dayPill}
        </p>
      ) : null}
      {unseen === 0 && far ? (
        <button
          type="button"
          className="chat__newbtn chat__newbtn--round"
          aria-label={t('Ir para a última mensagem')}
          onClick={() => {
            stickToEnd.current = true;
            window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
          }}
        >
          <ChevronDownIcon />
        </button>
      ) : null}
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
          {prep !== undefined ? prepareProgressText(prep) : t('Enviando…')}
        </p>
      ) : null}
      {selected ? (
        <div className="selectactions" role="toolbar" aria-label={t('Ações para as mensagens selecionadas')}>
          <button type="button" className="selectactions__btn" disabled={selected.length !== 1 || !data.canSend} onClick={() => { const only = chosen[0]; if (only) { startReply(only); setSelected(undefined); } }}>
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
          {data.request === 'OUTGOING' && data.other ? (
            <p className="chat__requestnote">{t('{name} ainda não segue você: sua mensagem chega como solicitação, sem aviso, e a pessoa decide se aceita.', { name: data.other.displayName })}</p>
          ) : null}
          <div className="chat__dock">
          {glow > 0 ? <span key={glow} className="chat__glow" aria-hidden="true" /> : null}
          {replyTo ? (
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
            {pendingGif ? (
              <div className="gifstage" role="group" aria-label={t('GIF para enviar')}>
                <span className="gifstage__item">
                  <GifImage url={pendingGif.url} />
                  <button type="button" className="stagebar__remove" aria-label={t('Tirar o GIF')} disabled={sending} onClick={() => setPendingGif(undefined)}>
                    <XIcon />
                  </button>
                </span>
              </div>
            ) : null}
            {staged.length > 0 ? (
              <div className="stagebar" role="group" aria-label={staged.length === 1 ? t('1 item para enviar') : t('{count} itens para enviar', { count: staged.length })}>
                <ul className="stagebar__list">
                  {staged.map((item, i) => (
                    <li key={item.id} className="stagebar__item">
                      {item.kind === 'IMAGE' && canEditImage(item.file.type) ? (
                        <>
                          <button type="button" className="stagebar__open" aria-label={t('Editar foto {n}', { n: i + 1 })} disabled={sending} onClick={() => setEditingId(item.id)}>
                            <img src={item.url} alt="" draggable={false} />
                          </button>
                          <button type="button" className="stagebar__edit" aria-hidden="true" tabIndex={-1} disabled={sending} onClick={() => setEditingId(item.id)}>
                            <EditIcon />
                          </button>
                        </>
                      ) : item.kind === 'IMAGE' ? (
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
              <input ref={galleryRef} type="file" multiple accept="image/*,video/*" className="visually-hidden" aria-label={t('Escolher fotos ou vídeos')} tabIndex={-1} onChange={(e) => void pickMedia(e)} />
              <input ref={fileRef} type="file" multiple accept={CHAT_FILE_ACCEPT} className="visually-hidden" aria-label={t('Escolher arquivo')} tabIndex={-1} onChange={(e) => void pickFile(e)} />
              <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="visually-hidden" aria-label={t('Tirar foto')} tabIndex={-1} onChange={(e) => void pickMedia(e)} />
              {recording ? (
                <VoiceRecorderBar mode={recording} slide={voiceSlide} control={voiceControl} onSend={sendVoice} onCancel={() => setRecording(false)} onProblem={setProblem} />
              ) : (
                <div className="composer__pill">
                  <button type="button" className="composer__camera" aria-label={t('Tirar foto')} disabled={sending} onClick={() => cameraRef.current?.click()}>
                    <CameraIcon />
                  </button>
                  <textarea
                    ref={inputRef}
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
                  {/* Emoji e GIF sempre à mão, como a figurinha do Instagram: dá para mandar um GIF sem escrever nada. */}
                  <CommentTools disabled={sending} closeKey={sentCount} onEmoji={(emoji) => setDraft((current) => (Array.from(current).length < MESSAGE_MAX ? current + emoji : current))} onGif={(gif) => setPendingGif(gif)} />
                  {draft.trim() !== '' || staged.length > 0 || pendingGif ? (
                    <>
                      {/* Escrevendo (ou com foto/GIF na fila): o canto vira o botão de enviar, como no Instagram. */}
                      <button
                        type="submit"
                        className="composer__sendtext"
                        disabled={sending}
                        aria-busy={sending || undefined}
                        aria-label={t('Enviar')}
                        // Tocar em enviar não tira o foco do campo: o teclado não fecha (o botão some logo depois, e o foco iria junto).
                        onPointerDown={(e) => {
                          if (document.activeElement === inputRef.current) e.preventDefault();
                        }}
                      >
                        <ArrowUpIcon />
                      </button>
                    </>
                  ) : (
                    <span className="composer__tools">
                      <button type="button" className="composer__tool" aria-label={t('Enviar arquivo (PDF, documento, planilha)')} disabled={sending} onClick={() => fileRef.current?.click()}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M20.5 11.5 12.6 19.4a5 5 0 0 1-7.1-7.1l8.1-8.1a3.3 3.3 0 0 1 4.7 4.7l-8.1 8.1a1.7 1.7 0 0 1-2.4-2.4l7.4-7.4" />
                        </svg>
                      </button>
                      <button type="button" className="composer__tool" aria-label={t('Enviar fotos ou vídeos da galeria')} onClick={() => galleryRef.current?.click()}>
                        <PhotoIcon />
                      </button>
                      <button
                        type="button"
                        className="composer__tool composer__mic"
                        aria-label={t('Gravar áudio (segure para gravar e solte para enviar)')}
                        onPointerDown={holdMic}
                        onContextMenu={(e) => e.preventDefault()}
                        onClick={() => {
                          // Toque no celular já foi tratado pelo gesto; aqui é o clique do mouse ou o teclado.
                          if (Date.now() - lastTouchAt.current < 800) return;
                          setProblem(undefined);
                          setRecording('locked');
                        }}
                      >
                        <MicIcon />
                      </button>
                      {micHint ? (
                        <span className="composer__michint" role="status">
                          {t('Segure para gravar, solte para enviar')}
                        </span>
                      ) : null}
                    </span>
                  )}
                </div>
              )}
            </form>
          </div>
        </>
      ) : data.left ? (
        <LeftGroupBar conversationId={conversationId} />
      ) : data.request === 'INCOMING' && data.other ? (
        <MessageRequestBar conversationId={conversationId} other={data.other} onAccepted={view.reload} />
      ) : (
        <Notice>{t('Vocês não se seguem mais. O histórico continua aqui; para mandar mensagem, siga a pessoa.')}</Notice>
      )}

      {actionsFor ? (
        <MessagePopup
          message={actionsFor}
          conversationId={conversationId}
          canSend={data.canSend}
          onClose={() => setActionsFor(undefined)}
          onReply={() => startReply(actionsFor)}
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

      {(() => {
        const item = staged.find((x) => x.id === editingId);
        return item ? <ImageEditor key={item.id} file={item.file} onDone={(file) => applyEdit(item.id, file)} onCancel={() => setEditingId(undefined)} /> : null;
      })()}
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

      {mapFor ? <PlaceMapSheet inviteId={match?.id} otherName={data.other?.displayName ?? ''} place={mapFor.place} onClose={() => setMapFor(undefined)} /> : null}

      {suggesting && match ? (
        <SuggestionsSheet
          title={placeAgreed ? t('Mudar local sugerido') : t('Sugerir um local')}
          agreedName={agreed?.name}
          searchOpen={suggesting === 'search'}
          inviteId={match.id}
          conversationId={conversationId}
          otherName={data.other?.displayName ?? ''}
          messages={messages}
          since={match.createdAt}
          onClose={() => setSuggesting(undefined)}
          onSent={(message) => {
            stickToEnd.current = true;
            setMessages((current) => mergeMessages(current, [message]));
            setSuggesting(undefined);
          }}
        />
      ) : null}
    </div>
  );
}

/** Grupo de que você saiu (ou que foi excluído): as mensagens até ali ficam para ler; excluir tira a conversa da sua lista. */
function LeftGroupBar({ conversationId }: { conversationId: string }) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();
  async function forget() {
    setBusy(true);
    setProblem(undefined);
    try {
      await api.forgetConversation(conversationId);
      navigate('/conversas');
    } catch (failure) {
      setProblem(toApiError(failure).message);
      setBusy(false);
    }
  }
  return (
    <div className="leftbar" role="status">
      <p className="muted">{t('Você não faz mais parte deste grupo. As mensagens até a sua saída continuam aqui para você.')}</p>
      {problem ? <p className="sugcard__problem">{problem}</p> : null}
      {confirming ? (
        <Confirm danger question={t('Excluir esta conversa? Ela some da sua lista e as mensagens somem para você.')} confirmLabel={t('Excluir conversa')} busy={busy} onCancel={() => setConfirming(false)} onConfirm={() => void forget()} />
      ) : (
        <Button full variant="secondary" onClick={() => setConfirming(true)}>
          {t('Excluir conversa')}
        </Button>
      )}
    </div>
  );
}
