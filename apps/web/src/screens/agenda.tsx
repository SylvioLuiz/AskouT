import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { DayStrip, Sheet, StateMark } from '../components/agenda.tsx';
import { PlusIcon } from '../components/icons.tsx';
import { Button, Confirm, ErrorState, Field, Loading, Notice, PageHead } from '../components/ui.tsx';
import { api } from '../client.ts';
import { useAsync, useTitle } from '../hooks.ts';
import {
  PRESETS,
  STATE_HELP,
  addDays,
  buildSlot,
  dayLongLabel,
  daysFrom,
  deviceTimeZone,
  localDateKey,
  meetupsOnDay,
  rangeForDays,
  slotsOnDay,
  statesOnDay,
  timeRangeLabel,
} from '../lib/agenda.ts';
import { toApiError } from '../lib/errors.ts';
import type { MeetupView, Slot, SlotState } from '../lib/types.ts';
import { Link } from '../router.tsx';

/** Quantos dias a faixa mostra a partir de hoje. */
const WINDOW_DAYS = 28;
const capitalize = (text: string) => text.charAt(0).toLocaleUpperCase('pt-BR') + text.slice(1);
const STATES: readonly SlotState[] = ['AVAILABLE', 'PARTIAL', 'UNAVAILABLE'];

function useDayWindow() {
  const today = useMemo(() => localDateKey(new Date()), []);
  const days = useMemo(() => daysFrom(today, WINDOW_DAYS), [today]);
  const range = useMemo(() => rangeForDays(today, WINDOW_DAYS), [today]);
  return { today, days, range };
}

function EventList({ meetups }: { meetups: MeetupView[] }) {
  return (
    <div className="agevents">
      <h3 className="agevents__title">Eventos que você vai</h3>
      <ul className="agevents__list">
        {meetups.map((m) => (
          <li key={m.id}>
            <Link to={`/conversas/${m.conversationId}`} className="agevent">
              <span className="agevent__time">{new Date(m.startsAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
              <span className="agevent__main">
                <strong>{m.title}</strong>
                {m.event?.venueName ? <span className="muted">{m.event.venueName}</span> : null}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SlotList({ slots, day, onRemove }: { slots: Slot[]; day: string; onRemove?: (slot: Slot) => void }) {
  return (
    <ul className="slots">
      {slots.map((slot) => (
        <li key={slot.id} className={`slot slot--${slot.state.toLowerCase()}`}>
          <div className="slot__body">
            <span className="slot__time">{timeRangeLabel(slot, day)}</span>
            <StateMark state={slot.state} />
          </div>
          {onRemove ? (
            <Button variant="quiet" small onClick={() => onRemove(slot)} aria-label={`Remover horário ${timeRangeLabel(slot, day)}`}>
              Remover
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

// ---------- Minha agenda ----------

function AddSlotSheet({ day, onClose, onSaved }: { day: string; onClose: () => void; onSaved: () => void }) {
  const [state, setState] = useState<SlotState>('AVAILABLE');
  const [start, setStart] = useState('18:00');
  const [end, setEnd] = useState('00:00');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(undefined);
    const built = buildSlot(day, start, end, new Date());
    if (!built.ok) {
      setErrors({ [built.field]: built.message });
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      await api.addSlot({ start: built.start, end: built.end, state });
      onSaved();
    } catch (failure) {
      const error = toApiError(failure);
      setErrors(error.fields);
      setFormError(Object.keys(error.fields).length === 0 ? error.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet title="Marcar horário" onClose={onClose}>
      <form className="form form--flat" onSubmit={submit} noValidate>
        <p className="muted">{dayLongLabel(day)}</p>

        <fieldset className="choice">
          <legend className="choice__legend">Como você está nesse período?</legend>
          {STATES.map((option) => (
            <label key={option} className={`choice__opt${state === option ? ' choice__opt--on' : ''}`}>
              <input type="radio" name="estado" value={option} checked={state === option} onChange={() => setState(option)} />
              <span className="choice__text">
                <StateMark state={option} />
                <span className="choice__help">{STATE_HELP[option]}</span>
              </span>
            </label>
          ))}
          {errors['state'] ? <p className="field__error" role="alert">{errors['state']}</p> : null}
        </fieldset>

        <div className="chips" role="group" aria-label="Atalhos de horário">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className="chip"
              aria-pressed={start === preset.start && end === preset.end}
              onClick={() => {
                setStart(preset.start);
                setEnd(preset.end);
                setErrors({});
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div className="form__pair">
          <Field label="Início" type="time" value={start} onChange={setStart} error={errors['start']} />
          <Field label="Fim" type="time" value={end} onChange={setEnd} error={errors['end']} hint="00:00 é meia-noite" />
        </div>

        {formError ? <Notice tone="error">{formError}</Notice> : null}
        <Button type="submit" full loading={saving}>
          Salvar horário
        </Button>
      </form>
    </Sheet>
  );
}

export function AgendaScreen() {
  useTitle('Agenda');
  const { today, days, range } = useDayWindow();
  const [selected, setSelected] = useState(today);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Slot | undefined>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | undefined>();
  const slots = useAsync(() => api.mySlots(range.from, range.to), [range.from, range.to]);
  const all = slots.data ?? [];
  const ofDay = slotsOnDay(all, selected);
  const meetups = useAsync(() => api.myMeetups(), []);
  const going = meetups.data?.items ?? [];
  const eventsToday = meetupsOnDay(going, selected);

  async function remove(slot: Slot) {
    setBusy(true);
    setMessage(undefined);
    try {
      await api.removeSlot(slot.id);
      setRemoving(undefined);
      setMessage({ tone: 'ok', text: 'Horário removido.' });
      slots.reload();
    } catch (failure) {
      setMessage({ tone: 'error', text: toApiError(failure).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead title="Agenda" subtitle="Só você vê esta agenda. Marque quando topa sair." />

      <DayStrip days={days} selected={selected} today={today} onSelect={(key) => { setSelected(key); setMessage(undefined); setRemoving(undefined); }} statesOf={(key) => statesOnDay(all, key)} eventsOf={(key) => meetupsOnDay(going, key).length} />

      <section className="section" aria-labelledby="dia-titulo">
        <h2 id="dia-titulo" className="section__title section__title--day">
          {capitalize(dayLongLabel(selected))}
          {selected === today ? <span className="today-tag">hoje</span> : null}
        </h2>

        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        {slots.loading && !slots.data ? <Loading /> : null}
        {slots.error ? <ErrorState message={slots.error.message} onRetry={slots.reload} /> : null}

        {slots.data && ofDay.length === 0 ? (
          <p className="muted">Nenhum horário marcado neste dia.</p>
        ) : null}
        {ofDay.length > 0 ? <SlotList slots={ofDay} day={selected} onRemove={(slot) => setRemoving(slot)} /> : null}
        {eventsToday.length > 0 ? <EventList meetups={eventsToday} /> : null}
        {removing ? (
          <Confirm
            question={`Remover o horário ${timeRangeLabel(removing, selected)}?`}
            confirmLabel="Remover"
            danger
            busy={busy}
            onCancel={() => setRemoving(undefined)}
            onConfirm={() => remove(removing)}
          />
        ) : null}
      </section>

      <button type="button" className="fab" onClick={() => setAdding(true)}>
        <PlusIcon />
        Marcar horário
      </button>

      {adding ? (
        <AddSlotSheet
          day={selected}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            setMessage({ tone: 'ok', text: 'Horário salvo.' });
            slots.reload();
          }}
        />
      ) : null}
    </>
  );
}
