import { useMemo, useState } from 'react';
import { Avatar, Button, EmptyState, ErrorState, Field, Loading } from './ui.tsx';
import { Sheet } from './agenda.tsx';
import { api } from '../client.ts';
import { useAsync } from '../hooks.ts';
import { formatWhen } from '../lib/chat.ts';
import { kindLabel, safeImage } from '../lib/explore.ts';
import { toApiError } from '../lib/errors.ts';
import { MEETUP_ACTION_LABEL, MEETUP_NAME_MAX, goingLabel, statusLabel, toggleId } from '../lib/meetup.ts';
import type { ExploreEvent, MeetupView } from '../lib/types.ts';
import { Link, navigate } from '../router.tsx';
/** Capa do evento do encontro: imagem https ou degradê pelo tipo. */
export function MeetupCover({ meetup }: { meetup: MeetupView }) {
  const [failed, setFailed] = useState(false);
  const kind = meetup.event?.kind ?? 'OTHER';
  const image = failed || !meetup.event ? null : safeImage(meetup.event.imageUrl);
  return (
    <div className={`evcover evcover--wide evcover--${kind.toLowerCase()} meetcard__cover`}>
      {image ? <img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <span className="evcover__kind" aria-hidden="true">{kindLabel(kind)}</span>}
      {meetup.event?.sample ? (
        <span className="evcover__tags">
          <span className="tag tag--sample">Exemplo de teste</span>
        </span>
      ) : null}
    </div>
  );
}

/** Dados do encontro (quando, onde, quantos vão). Serve para o cartão do chat e para a aba Eventos do grupo. */
export function MeetupFacts({ meetup, now }: { meetup: MeetupView; now: Date }) {
  return (
    <>
      <p className="meetcard__venue">{meetup.event?.venueName ?? 'Local do evento'}</p>
      <p className="meetcard__line">{formatWhen(meetup.startsAt, meetup.endsAt, now)}</p>
      <p className="meetcard__line">{goingLabel(meetup)}</p>
    </>
  );
}

/** Cartão do encontro dentro da conversa. Quem foi convidado aceita ou recusa aqui. */
export function MeetupBubble({ meetup, nowIso, onUpdated }: { meetup: MeetupView; nowIso: string; onUpdated: (m: MeetupView) => void }) {
  const [busy, setBusy] = useState<'accept' | 'decline' | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  const now = new Date(nowIso);
  const ended = Date.parse(meetup.endsAt) <= now.getTime();

  async function answer(action: 'accept' | 'decline') {
    setBusy(action);
    setProblem(undefined);
    try {
      onUpdated(await api.respondMeetup(meetup.id, action));
    } catch (failure) {
      setProblem(toApiError(failure).message);
    } finally {
      setBusy(undefined);
    }
  }

  const status = statusLabel(meetup.myStatus);
  const cancelled = meetup.status === 'CANCELLED';
  return (
    <div className="meetcard">
      <MeetupCover meetup={meetup} />
      <p className="meetcard__who">{meetup.myStatus === 'ORGANIZER' ? 'Você criou um encontro' : `${meetup.organizer.username} convidou você`}</p>
      <h3 className="meetcard__title">{meetup.title}</h3>
      <MeetupFacts meetup={meetup} now={now} />
      {meetup.isGroup && meetup.groupName ? <p className="meetcard__line">Grupo: {meetup.groupName}</p> : null}
      {cancelled ? (
        <p className="sugcard__answer sugcard__answer--no" role="status">Encontro cancelado</p>
      ) : meetup.myStatus === 'INVITED' ? (
        ended ? (
          <p className="sugcard__answer" role="status">Esse encontro já aconteceu</p>
        ) : (
          <>
            <div className="sugcard__actions">
              <Button small loading={busy === 'accept'} disabled={busy === 'decline'} onClick={() => answer('accept')}>
                Aceitar
              </Button>
              <Button small variant="secondary" loading={busy === 'decline'} disabled={busy === 'accept'} onClick={() => answer('decline')}>
                Recusar
              </Button>
            </div>
            {meetup.isGroup ? <p className="meetcard__hint">Ao aceitar, você entra no grupo.</p> : null}
          </>
        )
      ) : status ? (
        <p className={`sugcard__answer${meetup.myStatus === 'DECLINED' ? ' sugcard__answer--no' : ' sugcard__answer--yes'}`} role="status">
          {status}
        </p>
      ) : null}
      <div className="sugcard__links">
        {meetup.event ? <Link to={`/eventos/${encodeURIComponent(meetup.event.id)}`}>Ver evento</Link> : null}
        {meetup.isGroup && (meetup.myStatus === 'CONFIRMED' || meetup.myStatus === 'ORGANIZER') ? <Link to={`/conversas/${meetup.conversationId}`}>Abrir o grupo</Link> : null}
      </div>
      {problem ? <p className="sugcard__problem">{problem}</p> : null}
    </div>
  );
}

/** Lista de amigos para marcar. `exclude` esconde quem já está dentro. */
export function FriendPicker({ picked, onToggle, exclude = [] }: { picked: string[]; onToggle: (userId: string) => void; exclude?: readonly string[] }) {
  const friends = useAsync(() => api.friends(), []);
  const [filter, setFilter] = useState('');
  const available = useMemo(() => (friends.data ?? []).filter((f) => !exclude.includes(f.userId)), [friends.data, exclude]);
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return available.filter((f) => q === '' || f.username.toLowerCase().includes(q));
  }, [available, filter]);

  if (friends.loading) return <Loading />;
  if (friends.error) return <ErrorState message={friends.error.message} onRetry={friends.reload} />;
  if (available.length === 0) {
    return (
      <EmptyState title={exclude.length > 0 ? 'Nenhum amigo para convidar' : 'Você ainda não tem amigos no AskouT'}>
        {exclude.length > 0 ? 'Todos os seus amigos já estão aqui.' : 'Amigos são quem você segue e que segue você de volta. Encontre pessoas no Explorar.'}
      </EmptyState>
    );
  }
  return (
    <>
      {available.length > 6 ? <Field label="Buscar amigo" value={filter} onChange={setFilter} /> : null}
      <ul className="friendpick" aria-label="Amigos">
        {visible.map((f) => {
          const on = picked.includes(f.userId);
          return (
            <li key={f.userId}>
              <button type="button" className="friendpick__row" aria-pressed={on} onClick={() => onToggle(f.userId)}>
                <Avatar profile={f} size={40} />
                <span className="friendpick__name">
                  {f.username}
                </span>
                <span className={`friendpick__check${on ? ' friendpick__check--on' : ''}`} aria-hidden="true">
                  {on ? '✓' : ''}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** Folha para criar o encontro a partir de um evento: escolhe os amigos; com mais de um, nasce um grupo. */
export function CreateMeetupSheet({ event, onClose }: { event: ExploreEvent; onClose: () => void }) {
  const friends = useAsync(() => api.friends(), []);
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();

  async function create() {
    setBusy(true);
    setProblem(undefined);
    try {
      const meetup = await api.createMeetup({ eventId: event.id, guestIds: picked, name: picked.length > 1 && name.trim() !== '' ? name.trim() : undefined });
      onClose();
      navigate(`/conversas/${meetup.conversationId}`);
    } catch (failure) {
      setProblem(toApiError(failure).message);
      setBusy(false);
    }
  }

  return (
    <Sheet title={MEETUP_ACTION_LABEL} onClose={onClose}>
      <p className="muted meetsheet__intro">
        {event.title} · escolha quem convidar. Com uma pessoa, o convite vai para a conversa de vocês; com várias, cria um grupo e cada um entra ao aceitar.
      </p>
      <FriendPicker picked={picked} onToggle={(userId) => setPicked((cur) => toggleId(cur, userId))} />
      {friends.data && friends.data.length > 0 ? (
        <>
          {picked.length > 1 ? <Field label="Nome do grupo (opcional)" value={name} onChange={setName} maxLength={MEETUP_NAME_MAX} hint={`Se ficar vazio, usa "${event.title}".`} /> : null}
          {problem ? <p className="sugcard__problem">{problem}</p> : null}
          <Button full loading={busy} disabled={picked.length === 0} onClick={create}>
            {picked.length > 1 ? `${MEETUP_ACTION_LABEL} com ${picked.length} pessoas` : MEETUP_ACTION_LABEL}
          </Button>
        </>
      ) : null}
    </Sheet>
  );
}

/** Quem organiza: muda o nome, convida mais gente ou cancela o encontro. */
export function ManageMeetupSheet({ meetup, excludeIds, onClose, onChanged }: { meetup: MeetupView; excludeIds: readonly string[]; onClose: () => void; onChanged: (m: MeetupView) => void }) {
  const [title, setTitle] = useState(meetup.title);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState<'rename' | 'invite' | 'cancel' | undefined>();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();

  async function run(kind: 'rename' | 'invite' | 'cancel', work: () => Promise<MeetupView>) {
    setBusy(kind);
    setProblem(undefined);
    try {
      onChanged(await work());
      onClose();
    } catch (failure) {
      setProblem(toApiError(failure).message);
      setBusy(undefined);
    }
  }

  return (
    <Sheet title="Editar encontro" onClose={onClose}>
      <Field label="Nome do encontro" value={title} onChange={setTitle} maxLength={120} />
      <Button full loading={busy === 'rename'} disabled={title.trim() === '' || title.trim() === meetup.title} onClick={() => run('rename', () => api.renameMeetup(meetup.id, title.trim()))}>
        Salvar nome
      </Button>
      {meetup.isGroup ? (
        <>
          <h3 className="results__h">Convidar mais gente</h3>
          <FriendPicker picked={picked} onToggle={(userId) => setPicked((cur) => toggleId(cur, userId))} exclude={excludeIds} />
          <Button full variant="secondary" loading={busy === 'invite'} disabled={picked.length === 0} onClick={() => run('invite', () => api.inviteMeetup(meetup.id, picked))}>
            {picked.length > 1 ? `Convidar ${picked.length} pessoas` : 'Convidar'}
          </Button>
        </>
      ) : null}
      <h3 className="results__h">Cancelar</h3>
      {confirmCancel ? (
        <>
          <p className="muted">Todos os convidados são avisados de que o encontro foi cancelado.</p>
          <Button full variant="danger" loading={busy === 'cancel'} onClick={() => run('cancel', () => api.cancelMeetup(meetup.id))}>
            Sim, cancelar o encontro
          </Button>
        </>
      ) : (
        <Button full variant="secondary" onClick={() => setConfirmCancel(true)}>
          Cancelar encontro
        </Button>
      )}
      {problem ? <p className="sugcard__problem">{problem}</p> : null}
    </Sheet>
  );
}
