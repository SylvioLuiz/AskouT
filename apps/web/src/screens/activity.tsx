import { useState } from 'react';
import { PushCard } from '../components/notifications.tsx';
import { listTimeLabel } from '../lib/chat.ts';
import { navigate } from '../router.tsx';
import { announceNotificationsChanged } from '../lib/notifications.ts';
import { Button, EmptyState, ErrorState, Loading, Notice, PageHead, PersonRow } from '../components/ui.tsx';
import { api } from '../client.ts';
import { useAsync, usePolling, useTitle } from '../hooks.ts';
import { toApiError } from '../lib/errors.ts';
import { pluralize } from '../lib/format.ts';
import type { PublicProfile } from '../lib/types.ts';

export function ActivityScreen() {
  useTitle('Atividades');
  const requests = useAsync(() => api.followRequests({ limit: 50 }), []);
  const news = useAsync(() => api.notifications(), []);
  usePolling(news.reload, 15_000);
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
          ? `Você aprovou @${profile.username}. Agora vocês são amigos.`
          : `Você aprovou @${profile.username}. Siga de volta para virarem amigos.`;
      } else {
        await api.rejectRequest(profile.userId);
        text = `Você recusou o pedido de @${profile.username}.`;
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
      <PageHead title="Atividades" subtitle="Novidades e pedidos para seguir você" />
      <PushCard />
      {news.data && news.data.items.length > 0 ? (
        <>
          <div className="newshead">
            <h2 className="results__h">Novidades</h2>
            {news.data.unread > 0 ? (
              <Button small variant="quiet" onClick={() => void readAll()}>
                Marcar tudo como lido
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
                  {n.read ? null : <span className="visually-hidden">não lido</span>}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {news.data && news.data.items.length === 0 ? <p className="muted">Nenhuma novidade ainda. Mensagens, convites e encontros aparecem aqui.</p> : null}
      {news.error && !news.data ? <ErrorState message={news.error.message} onRetry={news.reload} /> : null}
      <h2 className="results__h">Pedidos para seguir</h2>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {requests.loading && !requests.data ? <Loading /> : null}
      {requests.error ? <ErrorState message={requests.error.message} onRetry={requests.reload} /> : null}
      {requests.data && requests.data.items.length === 0 ? (
        <EmptyState title="Nenhum pedido no momento">Quando alguém pedir para seguir seu perfil privado, o pedido aparece aqui.</EmptyState>
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
                      Aprovar
                    </Button>
                    <Button small variant="secondary" onClick={() => answer(profile, 'reject')} disabled={busyId === profile.userId}>
                      Recusar
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
