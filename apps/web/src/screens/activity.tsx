import { useEffect, useState } from 'react';
import { PushCard } from '../components/notifications.tsx';
import { listTimeLabel } from '../lib/chat.ts';
import { Link, navigate } from '../router.tsx';
import { announceNotificationsChanged, readActivitySeen, writeActivitySeen } from '../lib/notifications.ts';
import { useUser } from '../auth.tsx';
import { Button, EmptyState, ErrorState, Loading, Notice, PageHead, PersonRow } from '../components/ui.tsx';
import { api } from '../client.ts';
import { useAsync, usePolling, useTitle } from '../hooks.ts';
import { toApiError } from '../lib/errors.ts';
import { pluralize } from '../lib/format.ts';
import type { PublicProfile } from '../lib/types.ts';
import { t } from '../lib/i18n/index.ts';

export function ActivityScreen() {
  useTitle(t('Notificações'));
  const requests = useAsync(() => api.followRequests({ limit: 50 }), []);
  const news = useAsync(() => api.notifications(), []);
  const tagReqs = useAsync(() => api.pendingTags({ limit: 20 }), []);
  const [tagBusy, setTagBusy] = useState<string | undefined>();
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

  async function open(item: { id: string; url: string; read: boolean }) {
    if (!item.read) {
      try {
        await api.markNotificationsRead(item.id);
        announceNotificationsChanged();
      } catch {
        // abrir o aviso é mais importante que marcar como lido
      }
    }
    navigate(item.url);
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
      <PageHead title={t('Notificações')} subtitle={t('Novidades e pedidos para seguir você')} />
      <PushCard />
      {news.data && news.data.items.length > 0 ? (
        <>
          <div className="newshead">
            <h2 className="results__h">{t('Novidades')}</h2>
            {news.data.unread > 0 ? (
              <Button small variant="quiet" onClick={() => void readAll()}>
                {t('Marcar tudo como lido')}
              </Button>
            ) : null}
          </div>
          <ul className="newslist">
            {news.data.items.map((n) => (
              <li key={n.id}>
                <button type="button" className={`newsrow${n.read ? '' : ' newsrow--unread'}`} onClick={() => void open(n)}>
                  <span className="newsrow__dot" aria-hidden="true" />
                  <span className="newsrow__body">
                    <span className="newsrow__title">{n.title}</span>
                    <span className="newsrow__text">{n.body}</span>
                  </span>
                  <span className="newsrow__time">{listTimeLabel(n.createdAt, now)}</span>
                  {n.read ? null : <span className="visually-hidden">{t('não lido')}</span>}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {news.data && news.data.items.length === 0 ? <p className="muted">{t('Nenhuma novidade ainda. Mensagens, convites e encontros aparecem aqui.')}</p> : null}
      {news.error && !news.data ? <ErrorState message={news.error.message} onRetry={news.reload} /> : null}
      {tagReqs.data && tagReqs.data.items.length > 0 ? (
        <>
          <h2 className="results__h">{t('Marcações')}</h2>
          <ul className="list">
            {tagReqs.data.items.map((post) => (
              <li key={post.id} className="tagreq">
                <Link to={`/posts/${encodeURIComponent(post.id)}`} className="tagreq__link">
                  {post.images[0]?.path ? <img src={api.assetUrl(post.images[0].path)} alt="" referrerPolicy="no-referrer" /> : <span className="tagreq__none" />}
                  <span>
                    <strong>{post.author.username}</strong> {t('marcou você num post')}
                    {post.caption ? <span className="muted"> {post.caption.slice(0, 60)}</span> : null}
                  </span>
                </Link>
                <div className="row-actions">
                  <Button small onClick={() => void answerTag(post.id, 'accept')} loading={tagBusy === post.id}>
                    {t('Aceitar')}
                  </Button>
                  <Button small variant="secondary" onClick={() => void answerTag(post.id, 'decline')} disabled={tagBusy === post.id}>
                    {t('Recusar')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <h2 className="results__h">{t('Pedidos para seguir')}</h2>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
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
  );
}
