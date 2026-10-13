import { useState } from 'react';
import { MeetupCover } from '../components/meetup.tsx';
import { EmptyState, ErrorState, GroupAvatar, Loading, PageHead, PersonRow } from '../components/ui.tsx';
import { api } from '../client.ts';
import { useAsync, usePolling, useTitle } from '../hooks.ts';
import { peopleLabel } from '../lib/meetup.ts';
import type { MeetupView } from '../lib/types.ts';
import { Link } from '../router.tsx';

type Tab = 'people' | 'events' | 'media';

const dateFmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

function GroupEvent({ meetup }: { meetup: MeetupView }) {
  const start = new Date(meetup.startsAt);
  const body = (
    <>
      <MeetupCover meetup={meetup} />
      <div className="groupevent__body">
        <h3 className="groupevent__title">{meetup.title}</h3>
        <p className="groupevent__venue">{meetup.event?.venueName ?? 'Local do evento'}</p>
        <dl className="groupevent__facts">
          <div>
            <dt>Confirmados</dt>
            <dd>{meetup.confirmedCount}</dd>
          </div>
          <div>
            <dt>Data</dt>
            <dd>{dateFmt.format(start)}</dd>
          </div>
          <div>
            <dt>Hora</dt>
            <dd>{timeFmt.format(start)}</dd>
          </div>
        </dl>
      </div>
    </>
  );
  return (
    <li className="groupevent">
      {meetup.event ? (
        <Link to={`/eventos/${encodeURIComponent(meetup.event.id)}`} className="groupevent__link">
          {body}
        </Link>
      ) : (
        body
      )}
    </li>
  );
}

/** Detalhes do grupo: pessoas, eventos e mídia. Abre ao tocar no nome do grupo na conversa. */
export function GroupScreen({ conversationId }: { conversationId: string }) {
  const group = useAsync(() => api.group(conversationId), [conversationId]);
  usePolling(group.reload, 15_000);
  const [tab, setTab] = useState<Tab>('people');
  useTitle(group.data?.name ?? 'Grupo');

  if (group.loading && !group.data) return <Loading />;
  if (group.error && !group.data) {
    return (
      <>
        <PageHead title="Grupo" back={`/conversas/${conversationId}`} />
        {group.error.code === 'NOT_FOUND' ? (
          <EmptyState title="Grupo não encontrado">Só quem está no grupo vê os detalhes. Você entra no grupo ao aceitar o convite do encontro.</EmptyState>
        ) : (
          <ErrorState message={group.error.message} onRetry={group.reload} />
        )}
      </>
    );
  }
  const data = group.data!;
  const tabs: { id: Tab; label: string }[] = [
    { id: 'people', label: 'Pessoas' },
    { id: 'events', label: 'Eventos' },
    { id: 'media', label: 'Mídia' },
  ];

  return (
    <>
      <PageHead title={data.name} back={`/conversas/${conversationId}`} subtitle={peopleLabel(data.members.length)} />
      <div className="grouphead">
        <GroupAvatar name={data.name} size={96} />
      </div>
      <div className="segtabs segtabs--fill" role="tablist" aria-label="Detalhes do grupo">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className="segtabs__tab" onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'people' ? (
        <>
          <h2 className="results__h">Participantes</h2>
          <ul className="list">
            {data.members.map((m) => (
              <PersonRow key={m.profile.userId} profile={m.profile} aside={m.role === 'OWNER' ? <span className="tag tag--event">Criou o grupo</span> : undefined} />
            ))}
          </ul>
          <p className="muted">Entra no grupo quem aceita o convite do encontro.</p>
        </>
      ) : null}

      {tab === 'events' ? (
        data.meetups.length === 0 ? (
          <EmptyState title="Nenhum evento no grupo">Os encontros marcados com este grupo aparecem aqui.</EmptyState>
        ) : (
          <ul className="groupevents">
            {data.meetups.map((m) => (
              <GroupEvent key={m.id} meetup={m} />
            ))}
          </ul>
        )
      ) : null}

      {tab === 'media' ? <EmptyState title="Mídia ainda não está disponível">Fotos e vídeos do grupo vão aparecer aqui quando o envio de mídia existir no AskouT.</EmptyState> : null}
    </>
  );
}
