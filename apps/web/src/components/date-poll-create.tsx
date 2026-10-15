import { useState } from 'react';
import type { FormEvent } from 'react';
import { Sheet } from './agenda.tsx';
import { Button, Field, Notice } from './ui.tsx';
import { api } from '../client.ts';
import { POLICY_HINT, POLICY_LABEL } from '../lib/date-poll.ts';
import type { Policy } from '../lib/date-poll.ts';
import { toApiError } from '../lib/errors.ts';
import { navigate } from '../router.tsx';

const DURATIONS: { minutes: number; label: string }[] = [
  { minutes: 60, label: '1 h' },
  { minutes: 120, label: '2 h' },
  { minutes: 180, label: '3 h' },
  { minutes: 240, label: '4 h' },
  { minutes: 480, label: 'O dia todo' },
];


/** "Encontrar a melhor data": o organizador define o período e a regra; quem está na conversa vota. */
export function DatePollCreateSheet({ conversationId, onClose }: { conversationId: string; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [minutes, setMinutes] = useState(180);
  const [time, setTime] = useState('19:00');
  const [deadline, setDeadline] = useState('');
  const [policy, setPolicy] = useState<Policy>('MAJORITY');
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
        durationMinutes: minutes,
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

  return (
    <Sheet title="Encontrar a melhor data" onClose={onClose}>
      <form className="form" onSubmit={(e) => void submit(e)} noValidate>
        {problem ? <Notice tone="error">{problem}</Notice> : null}
        <Field label="Nome do encontro" value={title} onChange={setTitle} maxLength={120} placeholder="Churrasco de aniversário" />
        <div className="form__pair">
          <Field label="De" type="date" value={start} onChange={(v) => { setStart(v); if (end === '' || end < v) setEnd(v); }} />
          <Field label="Até" type="date" value={end} onChange={setEnd} />
        </div>
        <div className="optgroup" role="group" aria-label="Duração estimada">
          <span className="field__label">Duração estimada</span>
          <div className="chips">
            {DURATIONS.map((d) => (
              <button key={d.minutes} type="button" className="chip" aria-pressed={minutes === d.minutes} onClick={() => setMinutes(d.minutes)}>
                {d.label}
              </button>
            ))}
          </div>
        </div>
        <Field label="Horário preferido" type="time" value={time} onChange={setTime} hint="Usado ao propor a data. Dá para ajustar depois." />
        <Field label="Prazo para votar (opcional)" type="datetime-local" value={deadline} onChange={setDeadline} />
        <div className="optgroup" role="group" aria-label="Como a data é confirmada">
          <span className="field__label">Como a data é confirmada</span>
          <div className="chips">
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
