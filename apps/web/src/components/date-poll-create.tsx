import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Sheet } from './agenda.tsx';
import { Button, EmptyState, Field, Notice, PageHead } from './ui.tsx';
import { ChevronLeftIcon, ChevronRightIcon, MoonIcon, PlusIcon, SunIcon, SunriseIcon } from './icons.tsx';
import { api } from '../client.ts';
import { useAsync, useDebounced, useTitle } from '../hooks.ts';
import { formatWhen } from '../lib/chat.ts';
import type { ExploreEvent } from '../lib/types.ts';
import { SLOT_TIME, chipDay, dayInZone, eventDays, longDay, monthTitle, monthWeeks, shiftMonth } from '../lib/date-poll.ts';
import type { DaySlot, Policy } from '../lib/date-poll.ts';
import { toApiError } from '../lib/errors.ts';
import { isoToLocalInput } from '../lib/post-draft.ts';
import { navigate } from '../router.tsx';

const WEEK_HEAD = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const SLOTS: readonly { id: DaySlot; label: string; icon: ReactNode; tone: string }[] = [
  { id: 'MORNING', label: 'Manhã', icon: <SunriseIcon />, tone: 'sunrise' },
  { id: 'AFTERNOON', label: 'Tarde', icon: <SunIcon />, tone: 'sun' },
  { id: 'NIGHT', label: 'Noite', icon: <MoonIcon />, tone: 'moon' },
];
const POLICY_TEXT: Record<Policy, string> = {
  MAJORITY: 'A data será aprovada quando mais da metade confirmar.',
  MANUAL: 'Você escolhe a data entre as mais votadas.',
  UNANIMITY: 'A data só fecha quando todos confirmam.',
};

/** "Combinar uma data": nome, período e pronto. O resto é opcional. */
export function DatePollCreateScreen({ conversationId }: { conversationId: string }) {
  useTitle('Combinar uma data');
  const [title, setTitle] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [slot, setSlot] = useState<DaySlot | undefined>();
  const [deadline, setDeadline] = useState('');
  const [policy, setPolicy] = useState<Policy>('MAJORITY');
  const [event, setEvent] = useState<ExploreEvent | undefined>();
  const [picking, setPicking] = useState(false);
  const [calendar, setCalendar] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();

  const today = dayInZone(new Date().toISOString());
  // Com um evento escolhido, só dá para votar nos dias dele: o período fica travado.
  const eventRange = event?.startsAt ? eventDays(event.startsAt, event.endsAt, today) : undefined;
  const deadlineMax = event?.startsAt ? isoToLocalInput(event.startsAt) : undefined;

  async function submit(form: FormEvent) {
    form.preventDefault();
    setProblem(undefined);
    if (title.trim() === '') return setProblem('Dê um nome ao encontro.');
    if (start === '' || end === '') return setProblem('Escolha o período de datas.');
    if (eventRange && (start !== eventRange.start || end !== eventRange.end)) return setProblem('Com um evento, só dá para votar nos dias dele.');
    if (deadlineMax && deadline > deadlineMax) return setProblem('O prazo para votar não pode ser depois do início do evento.');
    setBusy(true);
    try {
      const poll = await api.createPoll({
        conversationId,
        title: title.trim(),
        rangeStart: start,
        rangeEnd: end,
        ...(slot ? { preferredTimeStart: SLOT_TIME[slot] } : {}),
        ...(deadline ? { votingDeadline: new Date(deadline).toISOString() } : {}),
        confirmationPolicy: policy,
      });
      navigate(`/planejar/${poll.id}`, { replace: true });
    } catch (failure) {
      setProblem(toApiError(failure).message);
      setBusy(false);
    }
  }

  return (
    <div className="pollform">
      <PageHead title="Combinar uma data" back={`/conversas/${conversationId}`} subtitle="Crie uma votação e encontre o melhor dia para reunir a galera." />
      <form className="pollform__form" onSubmit={(e) => void submit(e)} noValidate>
        {problem ? <Notice tone="error">{problem}</Notice> : null}

        <section className="pollcard">
          <div className="pollcard__body">
            <Field
              label="Nome do encontro"
              value={title}
              onChange={setTitle}
              maxLength={120}
              placeholder="Ex.: Churrasco de aniversário"
              autoComplete="off"
              trailing={
                <button type="button" className="iconbtn" aria-label="Usar um evento que já existe" onClick={() => setPicking(true)}>
                  <PlusIcon />
                </button>
              }
            />
          </div>
        </section>

        <section className="pollcard">
          <div className="pollcard__body">
            <p className="pollcard__label">Período de datas</p>
            <button type="button" className="pollrange" disabled={eventRange !== undefined} onClick={() => setCalendar(true)} aria-label={eventRange ? `Período do evento: ${longDay(start)}${end !== start ? ` a ${longDay(end)}` : ''}` : start && end ? `Período: ${longDay(start)} a ${longDay(end)}. Alterar` : 'Escolher o período de datas'}>
              {start && end ? (
                <span className="pollrange__value">
                  {chipDay(start)}
                  {end !== start ? (
                    <>
                      <span className="pollrange__arrow" aria-hidden="true">
                        →
                      </span>
                      {chipDay(end)}
                    </>
                  ) : null}
                </span>
              ) : (
                <span className="pollrange__empty">Escolha as datas</span>
              )}
            </button>
            {event && eventRange ? (
              <p className="pollcard__hint">
                {eventRange.start === eventRange.end ? `Só no dia do evento “${event.title}”.` : `Só nos dias do evento “${event.title}”.`}{' '}
                <button type="button" className="pollcard__unlink" onClick={() => setEvent(undefined)}>
                  Não usar este evento
                </button>
              </p>
            ) : null}
          </div>
        </section>

        <section className="pollcard">
          <div className="pollcard__body">
            <p className="pollcard__label">
              Melhor horário <span className="pollcard__opt">(opcional)</span>
            </p>
          </div>
          <div className="pollslots" role="group" aria-label="Melhor horário">
            {SLOTS.map((o) => (
              <button key={o.id} type="button" className={`pollslot pollslot--${o.tone}`} aria-pressed={slot === o.id} onClick={() => setSlot(slot === o.id ? undefined : o.id)}>
                {o.icon}
                {o.label}
              </button>
            ))}
          </div>
        </section>

        <section className="pollcard">
          <div className="pollcard__body">
            <p className="pollcard__label">Como escolher a data?</p>
          </div>
          <div className="pollpolicy" role="group" aria-label="Como escolher a data">
            <button type="button" className="pollpolicy__opt" aria-pressed={policy !== 'MANUAL'} onClick={() => setPolicy('MAJORITY')}>
              Maioria
            </button>
            <button type="button" className="pollpolicy__opt" aria-pressed={policy === 'MANUAL'} onClick={() => setPolicy('MANUAL')}>
              Eu decido
            </button>
          </div>
          <p className="pollcard__hint pollcard__hint--wide">{POLICY_TEXT[policy]}</p>
        </section>

        <details className="pollmore">
          <summary>Mais opções</summary>
          <div className="pollmore__body">
            <Field label="Prazo para votar" type="datetime-local" value={deadline} max={deadlineMax} onChange={setDeadline} hint={deadlineMax ? 'Não pode passar do início do evento.' : 'Sem prazo, a votação fica aberta até alguém encerrar.'} />
            <button type="button" className="chip pollmore__chip" aria-pressed={policy === 'UNANIMITY'} onClick={() => setPolicy(policy === 'UNANIMITY' ? 'MAJORITY' : 'UNANIMITY')}>
              Exigir que todos confirmem
            </button>
          </div>
        </details>

        <Button type="submit" full loading={busy}>
          Criar votação
        </Button>
        <p className="pollform__note">Quem está na conversa vota. A melhor data é só uma sugestão: ela vale depois que as pessoas confirmam.</p>
      </form>

      {calendar ? (
        <Sheet title="Período de datas" onClose={() => setCalendar(false)}>
          <RangeCalendar
            start={start}
            end={end}
            min={today}
            onPick={(a, b) => {
              setStart(a);
              setEnd(b);
              setCalendar(false);
            }}
          />
        </Sheet>
      ) : null}
      {picking ? (
        <Sheet title="Escolher um evento" onClose={() => setPicking(false)}>
          <EventPick
            onPick={(picked) => {
              setTitle(picked.title.slice(0, 120));
              setEvent(picked);
              if (picked.startsAt) {
                const range = eventDays(picked.startsAt, picked.endsAt, today);
                setStart(range.start);
                setEnd(range.end);
                if (deadline > isoToLocalInput(picked.startsAt)) setDeadline('');
              }
              setPicking(false);
            }}
            onBack={() => setPicking(false)}
          />
        </Sheet>
      ) : null}
    </div>
  );
}

/** Toque no primeiro dia e depois no último (o mesmo dia duas vezes vale um dia só). */
function RangeCalendar({ start, end, min, max, onPick }: { start: string; end: string; min: string; max?: string; onPick: (start: string, end: string) => void }) {
  const base = start || min;
  const [view, setView] = useState({ year: Number(base.slice(0, 4)), month: Number(base.slice(5, 7)) });
  const [anchor, setAnchor] = useState<string | undefined>();
  const first = `${view.year}-${String(view.month).padStart(2, '0')}-01`;
  const minView = { year: Number(min.slice(0, 4)), month: Number(min.slice(5, 7)) };
  const canBack = view.year * 12 + view.month > minView.year * 12 + minView.month;
  const canNext = !max || view.year * 12 + view.month < Number(max.slice(0, 4)) * 12 + Number(max.slice(5, 7));
  const from = anchor ?? start;
  const to = anchor ?? end;

  function tap(day: string) {
    if (!anchor) {
      setAnchor(day);
      return;
    }
    onPick(day < anchor ? day : anchor, day < anchor ? anchor : day);
  }

  return (
    <div className="pollcal">
      <div className="pollcal__nav">
        <button type="button" className="pollcal__arrow" aria-label="Mês anterior" disabled={!canBack} onClick={() => setView(shiftMonth(view.year, view.month, -1))}>
          <ChevronLeftIcon />
        </button>
        <strong aria-live="polite">{monthTitle(first)}</strong>
        <button type="button" className="pollcal__arrow" aria-label="Próximo mês" disabled={!canNext} onClick={() => setView(shiftMonth(view.year, view.month, 1))}>
          <ChevronRightIcon />
        </button>
      </div>
      <div className="pollcal__grid" role="grid">
        {WEEK_HEAD.map((d, i) => (
          <span key={i} className="pollcal__head" aria-hidden="true">
            {d}
          </span>
        ))}
        {monthWeeks(view.year, view.month).flat().map((day, i) => {
          if (!day) return <span key={i} />;
          const off = day < min || (max !== undefined && day > max);
          const edge = day === from || day === to;
          const inside = from !== '' && to !== '' && day > from && day < to;
          return (
            <button key={day} type="button" className={`pollcal__day${edge ? ' is-edge' : ''}${inside ? ' is-inside' : ''}`} disabled={off} aria-pressed={edge || inside} aria-label={longDay(day)} onClick={() => tap(day)}>
              {Number(day.slice(8, 10))}
            </button>
          );
        })}
      </div>
      <p className="pollcal__hint" role="status">
        {anchor ? 'Agora toque no último dia.' : 'Toque no primeiro e no último dia.'}
      </p>
    </div>
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
