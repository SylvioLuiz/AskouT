import { useState } from 'react';
import { Button, EmptyState, ErrorState, Loading, Notice, PageHead, PersonRow } from '../components/ui.tsx';
import { api } from '../client.ts';
import { useAsync, useTitle } from '../hooks.ts';
import { toApiError } from '../lib/errors.ts';
import { pluralize } from '../lib/format.ts';
import type { PublicProfile } from '../lib/types.ts';

export function ActivityScreen() {
  useTitle('Atividades');
  const requests = useAsync(() => api.followRequests({ limit: 50 }), []);
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

  return (
    <>
      <PageHead title="Atividades" subtitle="Pedidos para seguir você" />
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
