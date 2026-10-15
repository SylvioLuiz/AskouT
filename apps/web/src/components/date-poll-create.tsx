import { useState } from 'react';
import type { FormEvent } from 'react';
import { Sheet } from './agenda.tsx';
import { Button, EmptyState, Field, Notice } from './ui.tsx';
import { PlusIcon } from './icons.tsx';
import { api } from '../client.ts';
import { useAsync, useDebounced } from '../hooks.ts';
import { formatWhen } from '../lib/chat.ts';
import type { ExploreEvent } from '../lib/types.ts';
import { POLICY_HINT, POLICY_LABEL } from '../lib/date-poll.ts';
import type { Policy } from '../lib/date-poll.ts';
import { toApiError } from '../lib/errors.ts';
import { navigate } from '../router.tsx';


/** "Encontrar a melhor data": o organizador define o período e a regra; quem está na conversa vota. */
export function DatePollCreateSheet({ conversationId, onClose }: { conversationId: string; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [time, setTime] = useState('19:00');
  const [deadline, setDeadline] = useState('');
  const [policy, setPolicy] = useState<Policy>('MAJORITY');
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setProblem(undefined);
    if (title.trim() === '') return setProblem('Dê um nome ao encontro.');
    if (start === '' || end === '') return setProblem('Escolha a data inicial e a final.');
    setBusy(true);
    try {
      const poll = await api.createPoll({
        conversationId,
        title: title.trim(),
        rangeStart: start,
        rangeEnd: end,
        ...(time ? { preferredTimeStart: time } : {}),
        ...(deadline ? { votingDeadline: new Date(deadline).toISOString() } : {}),
        confirmationPolicy: policy,
      });
      onClose();
      navigate(`/planejar/${poll.id}`);
    } catch (failure) {
      setProblem(toApiError(failure).message);
      setBusy(false);
    }
  }

  if (picking) {
    return (
      <Sheet title="Escolher um evento" onClose={onClose}>
        <EventPick
          onPick={(event) => {
            setTitle(event.title.slice(0, 120));
            setPicking(false);
          }}
          onBack={() => setPicking(false)}
        />
      </Sheet>
    );
  }

  return (
    <Sheet title="Encontrar a melhor data" onClose={onClose}>
      <form className="form" onSubmit={(e) => void submit(e)} noValidate>
        {problem ? <Notice tone="error">{problem}</Notice> : null}
        <Field
          label="Nome do encontro"
          value={title}
          onChange={setTitle}
          maxLength={120}
          placeholder="Churrasco de aniversário"
          trailing={
            <button type="button" className="iconbtn" aria-label="Escolher um evento para o nome" onClick={() => setPicking(true)}>
              <PlusIcon />
            </button>
          }
        />
        <div className="form__pair">
          <Field label="De" type="date" value={start} onChange={(v) => { setStart(v); if (end === '' || end < v) setEnd(v); }} />
          <Field label="Até" type="date" value={end} onChange={setEnd} />
        </div>
        <Field label="Horário preferido" type="time" value={time} onChange={setTime} hint="Usado ao propor a data. Dá para ajustar depois." />
        <Field label="Prazo para votar (opcional)" type="datetime-local" value={deadline} onChange={setDeadline} />
        <div className="optgroup" role="group" aria-label="Como a data é confirmada">
          <span className="field__label">Como a data é confirmada</span>
          <div className="chips chips--fill">
            {(Object.keys(POLICY_LABEL) as Policy[]).map((p) => (
              <button key={p} type="button" className="chip" aria-pressed={policy === p} onClick={() => setPolicy(p)}>
                {POLICY_LABEL[p]}
              </button>
            ))}
          </div>
          <p className="muted">{POLICY_HINT[policy]}</p>
        </div>
        <p className="muted">Todos desta conversa podem votar. Os fusos são tratados em horário de Brasília.</p>
        <Button type="submit" full loading={busy}>
          Abrir votação
        </Button>
      </form>
    </Sheet>
  );
}

/** Eventos de quem você segue; digitando, busca em todos. Escolher um só preenche o nome. */
function EventPick({ onPick, onBack }: { onPick: (event: ExploreEvent) => void; onBack: () => void }) {
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim(), 350);
  const list = useAsync(async () => (q.length >= 2 ? (await api.explore({ q })).events : (await api.followedEvents()).events), [q]);
  const events = list.data ?? [];
  return (
    <>
      <Field label="Buscar evento" value={query} onChange={setQuery} placeholder="Nome do evento" autoFocus />
      {list.error ? <Notice tone="error">{list.error.message}</Notice> : null}
      {list.data && events.length === 0 ? <EmptyState title="Nenhum evento">{q.length >= 2 ? 'Tente outro nome.' : 'Digite o nome de um evento para buscar.'}</EmptyState> : null}
      <ul className="sharelist">
        {events.slice(0, 20).map((e) => (
          <li key={e.id}>
            <button type="button" className="sharelist__item" onClick={() => onPick(e)}>
              <strong>{e.title}</strong>
              <span>
                {formatWhen(e.startsAt, e.endsAt, new Date())} · {e.venue.name}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <Button variant="quiet" small onClick={onBack}>
        Voltar
      </Button>
    </>
  );
}
