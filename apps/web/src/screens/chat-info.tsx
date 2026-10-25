import { useEffect, useState } from 'react';
import { SharedEvents, SharedLinks, SharedMedia } from '../components/shared-tabs.tsx';
import { Avatar, EmptyState, ErrorState, Loading, PageHead } from '../components/ui.tsx';
import { api } from '../client.ts';
import { useAsync, useTitle } from '../hooks.ts';
import { Link, navigate } from '../router.tsx';
import { t } from '../lib/i18n/index.ts';

type Tab = 'events' | 'media' | 'links';

/** Informações da conversa 1 a 1: foto e nome da pessoa e as abas Eventos, Mídia e Links. */
export function ChatInfoScreen({ conversationId }: { conversationId: string }) {
  const shared = useAsync(() => api.shared(conversationId), [conversationId]);
  const [tab, setTab] = useState<Tab>('events');
  const data = shared.data;
  useTitle(data?.other ? data.other.displayName : t('Informações da conversa'));

  useEffect(() => {
    if (data?.type === 'GROUP') navigate(`/conversas/${conversationId}/grupo`, { replace: true });
  }, [data?.type, conversationId]);

  const back = `/conversas/${conversationId}`;
  if (shared.loading && !data) return <Loading />;
  if (shared.error && !data) {
    return (
      <>
        <PageHead title={t('Informações')} back={back} />
        {shared.error.code === 'NOT_FOUND' ? <EmptyState title={t('Conversa não encontrada')}>{t('Só quem participa vê as informações da conversa.')}</EmptyState> : <ErrorState message={shared.error.message} onRetry={shared.reload} />}
      </>
    );
  }
  if (!data || !data.other) return null;
  const other = data.other;
  const tabs: { id: Tab; label: string }[] = [
    { id: 'events', label: t('Eventos') },
    { id: 'media', label: t('Mídia') },
    { id: 'links', label: t('Links') },
  ];

  return (
    <>
      <PageHead title={t('Informações')} back={back} />
      <div className="chatinfo">
        <Link to={`/u/${encodeURIComponent(other.username)}`} className="chatinfo__who" aria-label={t('Ver perfil de {displayName}', { displayName: other.displayName })}>
          <Avatar profile={other} size={96} />
          <span className="chatinfo__name">{other.displayName}</span>
          <span className="chatinfo__handle">@{other.username}</span>
        </Link>
      </div>
      <div className="segtabs segtabs--fill" role="tablist" aria-label={t('Informações da conversa')}>
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className="segtabs__tab" onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'events' ? <SharedEvents meetups={data.meetups} /> : null}
      {tab === 'media' ? <SharedMedia voice={data.voice} media={data.media} conversationId={conversationId} /> : null}
      {tab === 'links' ? <SharedLinks links={data.links} /> : null}
    </>
  );
}
