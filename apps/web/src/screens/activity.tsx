import { useEffect, useRef, useState } from 'react';
import { PushCard } from '../components/notifications.tsx';
import { listTimeLabel } from '../lib/chat.ts';
import { Link, navigate, useSearch } from '../router.tsx';
import { announceNotificationsChanged, readActivitySeen, writeActivitySeen } from '../lib/notifications.ts';
import { useUser } from '../auth.tsx';
import { Avatar, Button, EmptyState, ErrorState, Loading, Notice, PageHead, PersonRow } from '../components/ui.tsx';
import { BellIcon, BoltIcon, CalendarIcon, ChatIcon, ClockIcon, CommentIcon, HeartIcon, PhotoIcon, ShieldIcon, UserPlusIcon } from '../components/icons.tsx';
import { api } from '../client.ts';
import { useAsync, usePolling, useTitle } from '../hooks.ts';
import { toApiError } from '../lib/errors.ts';
import { pluralize } from '../lib/format.ts';
import { rememberNotifications } from '../lib/tray.ts';
import type { NotificationCategory, NotificationItem, NotificationType, PublicProfile } from '../lib/types.ts';
import { t } from '../lib/i18n/index.ts';

/** Chips do topo da lista. Quais tipos entram em cada um é decidido no servidor (`notification-categories.ts`). */
const NEWS_FILTERS: ReadonlyArray<{ id: NotificationCategory; label: () => string }> = [
  { id: 'all', label: () => t('Todas') },
  { id: 'mentions', label: () => t('Menções') },
  { id: 'comments', label: () => t('Comentários') },
  { id: 'likes', label: () => t('Curtidas') },
  { id: 'follows', label: () => t('Seguidores') },
  { id: 'invites', label: () => t('Convites') },
  { id: 'events', label: () => t('Eventos') },
  { id: 'messages', label: () => t('Mensagens') },
];

type Category = 'chat' | 'event' | 'social' | 'now' | 'like' | 'comment' | 'system';

/** Categoria de cada tipo de aviso: define o ícone e a cor do selo. */
function categoryOf(type: NotificationType): Category {
  switch (type) {
    case 'MESSAGE':
    case 'GROUP_REMOVED':
      return 'chat';
    case 'MEETUP_INVITE':
    case 'MEETUP_ACCEPTED':
    case 'MEETUP_CANCELLED':
    case 'EVENT_REMINDER':
    case 'ALBUM_SUMMARY':
    case 'VENUE_CALENDAR':
    case 'VENUE_EVENT':
      return 'event';
    case 'FOLLOW_REQUEST':
    case 'FOLLOW_ACCEPTED':
    case 'FOLLOW_NEW':
    case 'POST_TAG':
      return 'social';
    case 'FLASH_INVITE':
      return 'now';
    case 'POST_LIKE':
      return 'like';
    case 'POST_COMMENT':
      return 'comment';
    default:
      return 'system';
  }
}

function CategoryIcon({ type }: { type: NotificationType }) {
  switch (type) {
    case 'MESSAGE':
    case 'GROUP_REMOVED':
      return <ChatIcon />;
    case 'EVENT_REMINDER':
      return <ClockIcon />;
    case 'MEETUP_INVITE':
    case 'MEETUP_ACCEPTED':
    case 'MEETUP_CANCELLED':
    case 'VENUE_CALENDAR':
    case 'VENUE_EVENT':
      return <CalendarIcon />;
    case 'FOLLOW_REQUEST':
    case 'FOLLOW_ACCEPTED':
    case 'FOLLOW_NEW':
      return <UserPlusIcon />;
    case 'POST_TAG':
    case 'ALBUM_SUMMARY':
      return <PhotoIcon />;
    case 'FLASH_INVITE':
      return <BoltIcon filled />;
    case 'POST_LIKE':
      return <HeartIcon filled />;
    case 'POST_COMMENT':
      return <CommentIcon />;
    case 'VENUE_CLAIM':
      return <ShieldIcon />;
    default:
      return <BellIcon />;
  }
}

/** Como no Instagram: foto de quem causou o aviso com um selo da categoria; sem pessoa, só o ícone da categoria. */
function NewsMedia({ item }: { item: NotificationItem }) {
  const category = categoryOf(item.type);
  if (item.actor) {
    return (
      <span className="newsmedia">
        <Avatar profile={{ ...item.actor, displayName: item.actor.username }} size={44} />
        <span className={`newsmedia__badge newscat--${category}`} aria-hidden="true">
          <CategoryIcon type={item.type} />
        </span>
      </span>
    );
  }
  return (
    <span className={`newsmedia newsmedia__icon newscat--${category}`} aria-hidden="true">
      <CategoryIcon type={item.type} />
    </span>
  );
}

export function ActivityScreen() {
  useTitle(t('Notificações'));
  const search = useSearch();
  const [tab, setTab] = useState<'news' | 'requests'>(search.get('aba') === 'pedidos' ? 'requests' : 'news');
  useEffect(() => {
    if (search.get('aba') === 'pedidos') setTab('requests');
  }, [search.get('aba')]);
  const requests = useAsync(() => api.followRequests({ limit: 50 }), []);
  // Chips do topo (como no Instagram). O servidor filtra, para a página trazer os 30 mais recentes daquela categoria.
  const [filter, setFilter] = useState<NotificationCategory>('all');
  const newsState = useAsync(async () => ({ category: filter, list: await api.notifications(filter) }), [filter]);
  // Ao trocar de chip, a lista anterior some na hora (em vez de mostrar avisos de outra categoria até a resposta chegar).
  const news = { data: newsState.data?.category === filter ? newsState.data.list : undefined, error: newsState.error, reload: newsState.reload };
  const totalUnread = newsState.data?.list.unread ?? 0;
  // Título e texto dos avisos: o app do celular usa para tirar da bandeja o aviso da tela aberta por aqui.
  useEffect(() => {
    if (newsState.data) rememberNotifications(newsState.data.list.items);
  }, [newsState.data]);
  const tagReqs = useAsync(() => api.pendingTags({ limit: 20 }), []);
  const [tagBusy, setTagBusy] = useState<string | undefined>();
  const pendingTagIds = new Set(tagReqs.data?.items.map((p) => p.id) ?? []);
  // Marcações que já aparecem como aviso na lista ganham os botões lá; a seção de baixo fica só com as outras.
  const tagsInList = new Set((news.data?.items ?? []).flatMap((n) => (n.type === 'POST_TAG' && n.postId ? [n.postId] : [])));
  const otherTags = tagReqs.data?.items.filter((p) => !tagsInList.has(p.id)) ?? [];
  async function answerTag(postId: string, action: 'accept' | 'decline') {
    setTagBusy(postId);
    setMessage(undefined);
    try {
      await api.respondTag(postId, action);
      if (tagReqs.data) tagReqs.setData({ ...tagReqs.data, items: tagReqs.data.items.filter((p) => p.id !== postId) });
      setMessage({ tone: 'ok', text: action === 'accept' ? t('Marcação aceita. O post aparece no seu perfil e no seu feed.') : t('Marcação recusada.') });
    } catch (failure) {
      setMessage({ tone: 'error', text: toApiError(failure).message });
      tagReqs.reload();
    } finally {
      setTagBusy(undefined);
    }
  }
  usePolling(news.reload, 15_000);

  // Abrir Atividades apaga a bolinha do sino: tudo o que está na tela já foi "visto", mesmo sem abrir cada aviso.
  // Cada aviso não aberto continua marcado aqui dentro.
  const me = useUser();
  useEffect(() => {
    if (!news.data || !requests.data) return;
    let storage: Storage | undefined;
    try {
      storage = window.localStorage;
    } catch {
      storage = undefined;
    }
    const before = readActivitySeen(storage, me.id);
    const unread = news.data.items.filter((n) => !n.read).map((n) => n.createdAt);
    const latest = unread.length > 0 ? unread.reduce((a, b) => (a > b ? a : b)) : null;
    const newsAt = latest !== null && (before.newsAt === null || latest > before.newsAt) ? latest : before.newsAt;
    const next = { newsAt, requests: requests.data.total };
    if (next.newsAt !== before.newsAt || next.requests !== before.requests) {
      writeActivitySeen(storage, me.id, next);
      announceNotificationsChanged();
    }
  }, [news.data, requests.data, me.id]);
  const [busyId, setBusyId] = useState<string | undefined>();
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | undefined>();

  async function answer(profile: PublicProfile, decision: 'approve' | 'reject') {
    setBusyId(profile.userId);
    setMessage(undefined);
    try {
      let text: string;
      if (decision === 'approve') {
        const result = await api.approveRequest(profile.userId);
        text = result.isFriend
          ? t('Você aprovou {username}. Agora vocês são amigos.', { username: profile.username })
          : t('Você aprovou {username}. Siga de volta para virarem amigos.', { username: profile.username });
      } else {
        await api.rejectRequest(profile.userId);
        text = t('Você recusou o pedido de {username}.', { username: profile.username });
      }
      if (requests.data) {
        requests.setData({
          ...requests.data,
          items: requests.data.items.filter((item) => item.userId !== profile.userId),
          total: Math.max(0, requests.data.total - 1),
        });
      }
      setMessage({ tone: 'ok', text });
    } catch (failure) {
      setMessage({ tone: 'error', text: toApiError(failure).message });
      requests.reload();
    } finally {
      setBusyId(undefined);
    }
  }

  async function open(item: { id: string; url: string; read: boolean; type: NotificationType; postId?: string | null }) {
    if (!item.read) {
      try {
        await api.markNotificationsRead(item.id);
        announceNotificationsChanged();
      } catch {
        // abrir o aviso é mais importante que marcar como lido
      }
    }
    // Marcação: abre o post/evento para ver antes de aceitar (avisos antigos apontavam só para /atividades).
    if (item.type === 'POST_TAG' && item.postId) {
      navigate(`/posts/${encodeURIComponent(item.postId)}`);
      return;
    }
    // Pedido para seguir abre a aba de pedidos aqui mesmo (avisos antigos apontam só para /atividades).
    if (item.type === 'FOLLOW_REQUEST' && item.url.startsWith('/atividades')) {
      setTab('requests');
      return;
    }
    // Aviso de comentário abre o post já com os comentários à vista (avisos antigos vinham sem o `?comentarios=1`).
    if (item.type === 'POST_COMMENT' && /^\/posts\/[^/?#]+$/.test(item.url)) {
      navigate(`${item.url}?comentarios=1`);
      return;
    }
    navigate(item.url);
  }

  // Seleção (como no Gmail/Instagram): "Selecionar" ou segurar um aviso; tocar marca/desmarca; "Marcar como vistas" lê só os escolhidos.
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [markingSelected, setMarkingSelected] = useState(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const skipClick = useRef(false);
  const visibleIds = news.data?.items.map((n) => n.id) ?? [];
  // A lista recarrega sozinha a cada 15 s: só contam os escolhidos que ainda estão na tela.
  const chosen = visibleIds.filter((id) => selected.has(id));
  useEffect(() => {
    setSelecting(false);
    setSelected(new Set());
  }, [filter, tab]);

  function stopSelecting() {
    setSelecting(false);
    setSelected(new Set());
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function startPress(id: string) {
    if (selecting) return;
    clearTimeout(pressTimer.current);
    pressTimer.current = setTimeout(() => {
      skipClick.current = true;
      setSelecting(true);
      setSelected(new Set([id]));
    }, 500);
  }

  function cancelPress() {
    clearTimeout(pressTimer.current);
  }

  function rowClick(item: NotificationItem) {
    if (skipClick.current) {
      skipClick.current = false;
      return;
    }
    if (selecting) toggleSelected(item.id);
    else void open(item);
  }

  async function readSelected() {
    if (chosen.length === 0) return;
    setMarkingSelected(true);
    setMessage(undefined);
    try {
      await api.markNotificationsRead(chosen);
      if (newsState.data) {
        const marked = new Set(chosen);
        const list = newsState.data.list;
        const newlyRead = list.items.filter((n) => marked.has(n.id) && !n.read).length;
        newsState.setData({ ...newsState.data, list: { items: list.items.map((n) => (marked.has(n.id) ? { ...n, read: true } : n)), unread: Math.max(0, list.unread - newlyRead) } });
      }
      announceNotificationsChanged();
      stopSelecting();
      news.reload();
    } catch (failure) {
      setMessage({ tone: 'error', text: toApiError(failure).message });
    } finally {
      setMarkingSelected(false);
    }
  }

  async function readAll() {
    try {
      await api.markNotificationsRead();
      announceNotificationsChanged();
      news.reload();
    } catch (failure) {
      setMessage({ tone: 'error', text: toApiError(failure).message });
    }
  }

  const now = new Date();
  return (
    <>
      <PageHead title={t('Notificações')} />
      <PushCard hideInstallHint />
      <div className="segtabs segtabs--fill" role="tablist" aria-label={t('Notificações')}>
        <button type="button" role="tab" aria-selected={tab === 'news'} className="segtabs__tab" onClick={() => setTab('news')}>
          {t('Novidades')}
          {totalUnread > 0 ? <span className="segtabs__n">{totalUnread > 99 ? '99+' : totalUnread}</span> : null}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'requests'} className="segtabs__tab" onClick={() => setTab('requests')}>
          {t('Pedidos para seguir')}
          {requests.data && requests.data.total > 0 ? <span className="segtabs__n">{requests.data.total > 99 ? '99+' : requests.data.total}</span> : null}
        </button>
      </div>
      {tab === 'news' ? (
        <>
      <div className="newsfilters" role="group" aria-label={t('Filtrar notificações')}>
        {NEWS_FILTERS.map((f) => (
          <button key={f.id} type="button" className="chip newsfilters__chip" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label()}
          </button>
        ))}
      </div>
      {!news.data && !news.error ? <Loading /> : null}
      {news.data && news.data.items.length > 0 ? (
        <>
          {selecting ? (
            <div className="newshead newshead--select" role="toolbar" aria-label={t('Avisos selecionados')}>
              <span className="newshead__count" aria-live="polite">
                {chosen.length === 0 ? t('Toque nos avisos para escolher') : chosen.length === 1 ? t('1 selecionado') : t('{n} selecionados', { n: chosen.length })}
              </span>
              <Button small variant="quiet" onClick={stopSelecting}>
                {t('Cancelar')}
              </Button>
              <Button small variant="quiet" onClick={() => setSelected(chosen.length === visibleIds.length ? new Set() : new Set(visibleIds))}>
                {chosen.length === visibleIds.length ? t('Desmarcar todos') : t('Selecionar todos')}
              </Button>
              <Button small loading={markingSelected} disabled={chosen.length === 0} onClick={() => readSelected()}>
                {t('Marcar como vistas')}
              </Button>
            </div>
          ) : (
            <div className="newshead">
              <Button small variant="quiet" onClick={() => setSelecting(true)}>
                {t('Selecionar')}
              </Button>
              {news.data.unread > 0 ? (
                <Button small variant="quiet" onClick={() => readAll()}>
                  {t('Marcar tudo como lido')}
                </Button>
              ) : null}
            </div>
          )}
          <ul className="newslist">
            {news.data.items.map((n) => {
              const isChosen = selecting && selected.has(n.id);
              const tagActions = !selecting && n.type === 'POST_TAG' && !!n.postId && pendingTagIds.has(n.postId);
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    className={`newsrow${n.read ? '' : ' newsrow--unread'}${selecting ? ' newsrow--selecting' : ''}${isChosen ? ' newsrow--chosen' : ''}${tagActions ? ' newsrow--withactions' : ''}`}
                    aria-pressed={selecting ? isChosen : undefined}
                    onClick={() => rowClick(n)}
                    onPointerDown={() => startPress(n.id)}
                    onPointerUp={cancelPress}
                    onPointerLeave={cancelPress}
                    onPointerCancel={cancelPress}
                    onContextMenu={(e) => {
                      if (!selecting) e.preventDefault();
                    }}
                  >
                    {selecting ? <span className="newsrow__check" aria-hidden="true" /> : null}
                    <NewsMedia item={n} />
                    <span className="newsrow__body">
                      <span className="newsrow__title">{n.title}</span>
                      <span className="newsrow__text">{n.body}</span>
                    </span>
                    <span className="newsrow__time">{listTimeLabel(n.createdAt, now)}</span>
                    <span className="newsrow__dot" aria-hidden="true" />
                    {n.read ? null : <span className="visually-hidden">{t('não lido')}</span>}
                  </button>
                  {tagActions && n.postId ? (
                    <div className="row-actions newsrow__actions">
                      <Button small onClick={() => answerTag(n.postId as string, 'accept')} loading={tagBusy === n.postId}>
                        {t('Aceitar')}
                      </Button>
                      <Button small variant="secondary" onClick={() => answerTag(n.postId as string, 'decline')} disabled={tagBusy === n.postId}>
                        {t('Recusar')}
                      </Button>
                      <Button small variant="quiet" onClick={() => open(n)}>
                        {t('Ver')}
                      </Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
      {news.data && news.data.items.length === 0 ? (
        <p className="muted">{filter === 'all' ? t('Nenhuma novidade ainda. Mensagens, convites e encontros aparecem aqui.') : t('Nada por aqui neste filtro.')}</p>
      ) : null}
      {news.error && !news.data ? <ErrorState message={news.error.message} onRetry={news.reload} /> : null}
      {(filter === 'all' || filter === 'mentions') && otherTags.length > 0 ? (
        <>
          <h2 className="results__h">{t('Marcações')}</h2>
          <ul className="list">
            {otherTags.map((post) => (
              <li key={post.id} className="tagreq">
                <Link to={`/posts/${encodeURIComponent(post.id)}`} className="tagreq__link">
                  {post.images[0]?.path ? <img src={api.assetUrl(post.images[0].path)} alt="" referrerPolicy="no-referrer" /> : <span className="tagreq__none" />}
                  <span>
                    <strong>{post.author.username}</strong> {t('marcou você num post')}
                    {post.caption ? <span className="muted"> {post.caption.slice(0, 60)}</span> : null}
                  </span>
                </Link>
                <div className="row-actions">
                  <Button small onClick={() => answerTag(post.id, 'accept')} loading={tagBusy === post.id}>
                    {t('Aceitar')}
                  </Button>
                  <Button small variant="secondary" onClick={() => answerTag(post.id, 'decline')} disabled={tagBusy === post.id}>
                    {t('Recusar')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}
        </>
      ) : null}
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {tab === 'requests' ? (
        <>
      {requests.loading && !requests.data ? <Loading /> : null}
      {requests.error ? <ErrorState message={requests.error.message} onRetry={requests.reload} /> : null}
      {requests.data && requests.data.items.length === 0 ? (
        <EmptyState title={t('Nenhum pedido no momento')}>{t('Quando alguém pedir para seguir seu perfil privado, o pedido aparece aqui.')}</EmptyState>
      ) : null}
      {requests.data && requests.data.items.length > 0 ? (
        <>
          <p className="muted">{pluralize(requests.data.total, 'pedido', 'pedidos')}</p>
          <ul className="list">
            {requests.data.items.map((profile) => (
              <PersonRow
                key={profile.userId}
                profile={profile}
                aside={
                  <div className="row-actions">
                    <Button small onClick={() => answer(profile, 'approve')} loading={busyId === profile.userId}>
                      {t('Aprovar')}
                    </Button>
                    <Button small variant="secondary" onClick={() => answer(profile, 'reject')} disabled={busyId === profile.userId}>
                      {t('Recusar')}
                    </Button>
                  </div>
                }
              />
            ))}
          </ul>
        </>
      ) : null}
        </>
      ) : null}
    </>
  );
}
