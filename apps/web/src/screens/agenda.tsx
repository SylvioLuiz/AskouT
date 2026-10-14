import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { DayStrip, LevelBadge, ParticipantMark, Sheet, StateMark } from '../components/agenda.tsx';
import { PlusIcon } from '../components/icons.tsx';
import { Avatar, Button, Confirm, EmptyState, ErrorState, Field, Loading, Notice, PageHead } from '../components/ui.tsx';
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
  instantRangeLabel,
  localDateKey,
  rangeForDays,
  slotsOnDay,
  statesOnDay,
  timeRangeLabel,
} from '../lib/agenda.ts';
import { toApiError } from '../lib/errors.ts';
import type { Compatibility, Slot, SlotState } from '../lib/types.ts';
import { Link, useSearch } from '../router.tsx';

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
      <PageHead title="Agenda" subtitle="Diga quando você topa sair. Seus amigos veem e comparam." />

      <DayStrip days={days} selected={selected} today={today} onSelect={(key) => { setSelected(key); setMessage(undefined); setRemoving(undefined); }} statesOf={(key) => statesOnDay(all, key)} />

      <section className="section" aria-labelledby="dia-titulo">
        <h2 id="dia-titulo" className="section__title section__title--day">
          {capitalize(dayLongLabel(selected))}
          {selected === today ? <span className="today-tag">hoje</span> : null}
        </h2>

        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        {slots.loading && !slots.data ? <Loading /> : null}
        {slots.error ? <ErrorState message={slots.error.message} onRetry={slots.reload} /> : null}

        {slots.data && ofDay.length === 0 ? (
          <p className="muted">Nenhum horário marcado neste dia. Para quem compara com você, dia sem horário aparece como “sem informação”, nunca como indisponível.</p>
        ) : null}
        {ofDay.length > 0 ? <SlotList slots={ofDay} day={selected} onRemove={(slot) => setRemoving(slot)} /> : null}
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

      <section className="section">
        <Link to="/agenda/comparar" className="callout callout--link">
          <span className="callout__text">
            <strong>Encontrar melhor data</strong>
            <br />
            Compare sua agenda com a dos amigos e veja os melhores horários.
          </span>
        </Link>
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

// ---------- Agenda de um amigo ----------

export function FriendAgendaScreen({ username }: { username: string }) {
  const { today, days, range } = useDayWindow();
  const [selected, setSelected] = useState(today);
  const profile = useAsync(() => api.getProfile(username), [username]);
  const isFriend = profile.data?.relationship.isFriend === true;
  const userId = profile.data?.profile.userId;
  useTitle(profile.data ? `Agenda de ${profile.data.profile.username}` : 'Agenda');

  const slots = useAsync(
    () => (isFriend && userId ? api.friendSlots(userId, range.from, range.to) : Promise.resolve(undefined)),
    [isFriend, userId, range.from, range.to],
  );
  const all = slots.data?.slots ?? [];
  const ofDay = slotsOnDay(all, selected);
  const back = `/u/${encodeURIComponent(username)}`;

  if (profile.loading && !profile.data) return <Loading />;
  if (profile.error) return <ErrorState message={profile.error.message} onRetry={profile.reload} />;
  if (!profile.data) return null;

  const name = profile.data.profile.username;
  if (!isFriend) {
    return (
      <>
        <PageHead title={`Agenda de ${name}`} back={back} />
        <EmptyState title="A agenda é só para amigos">Vocês precisam se seguir para ver os horários um do outro.</EmptyState>
      </>
    );
  }

  return (
    <>
      <PageHead title={`Agenda de ${name}`} back={back} />
      <DayStrip days={days} selected={selected} today={today} onSelect={setSelected} statesOf={(key) => statesOnDay(all, key)} />
      <section className="section" aria-labelledby="dia-titulo">
        <h2 id="dia-titulo" className="section__title section__title--day">
          {capitalize(dayLongLabel(selected))}
          {selected === today ? <span className="today-tag">hoje</span> : null}
        </h2>
        {slots.loading && !slots.data ? <Loading /> : null}
        {slots.error ? <ErrorState message={slots.error.message} onRetry={slots.reload} /> : null}
        {slots.data && ofDay.length === 0 ? <p className="muted">{name} não marcou horários neste dia. Isso quer dizer “sem informação”, não “indisponível”.</p> : null}
        {ofDay.length > 0 ? <SlotList slots={ofDay} day={selected} /> : null}
      </section>
      <Link to={`/agenda/comparar?com=${encodeURIComponent(username)}`} className="btn btn--primary">
        Comparar com {username}
      </Link>
    </>
  );
}

// ---------- Encontrar melhor data ----------

const TURNS = [
  { id: 'night', label: 'Noite', earliest: '17:00', latest: '22:00' },
  { id: 'afternoon', label: 'Tarde', earliest: '12:00', latest: '17:00' },
  { id: 'morning', label: 'Manhã', earliest: '08:00', latest: '11:00' },
  { id: 'any', label: 'Qualquer hora', earliest: '08:00', latest: '22:00' },
] as const;
const PERIODS = [
  { days: 7, label: '7 dias' },
  { days: 14, label: '14 dias' },
  { days: 30, label: '30 dias' },
] as const;
const DURATIONS = [
  { minutes: 60, label: '1 h' },
  { minutes: 120, label: '2 h' },
  { minutes: 180, label: '3 h' },
  { minutes: 240, label: '4 h' },
] as const;
const MAX_FRIENDS = 9;

function Chips<T extends string | number>({ label, options, value, onChange }: { label: string; options: readonly { value: T; label: string }[]; value: T; onChange: (value: T) => void }) {
  return (
    <div className="optgroup">
      <p className="optgroup__label" id={`g-${label}`}>
        {label}
      </p>
      <div className="chips" role="group" aria-labelledby={`g-${label}`}>
        {options.map((option) => (
          <button key={String(option.value)} type="button" className="chip" aria-pressed={option.value === value} onClick={() => onChange(option.value)}>
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ResultCard({ result }: { result: Compatibility }) {
  const { counts } = result;
  const summary =
    counts.unknown > 0
      ? `${counts.unknown} ${counts.unknown === 1 ? 'pessoa ainda não marcou' : 'pessoas ainda não marcaram'} horários`
      : `${counts.available} de ${counts.total} disponíveis${counts.partial > 0 ? `, ${counts.partial} parcial` : ''}`;
  return (
    <li className={`result result--${result.level}`}>
      <LevelBadge level={result.level} />
      <p className="result__when">{instantRangeLabel(result.start, result.end)}</p>
      <p className="muted result__summary">{summary}</p>
      <details className="result__who">
        <summary>Ver quem pode</summary>
        <ul className="who">
          {result.participants.map((p) => (
            <li key={p.profile.userId} className="who__row">
              <Avatar profile={p.profile} size={32} />
              <span className="who__name">{p.isMe ? 'Você' : p.profile.username}</span>
              <ParticipantMark status={p.status} />
            </li>
          ))}
        </ul>
      </details>
    </li>
  );
}

export function CompareScreen() {
  useTitle('Encontrar melhor data');
  const preselect = useSearch().get('com');
  const friends = useAsync(() => api.friends(), []);
  const [selected, setSelected] = useState<string[]>([]);
  const [period, setPeriod] = useState<number>(14);
  const [duration, setDuration] = useState<number>(120);
  const [turn, setTurn] = useState<string>('night');
  const [results, setResults] = useState<Compatibility[] | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  // Vindo da agenda de um amigo, ele já começa marcado (uma vez só, quando a lista chega).
  useEffect(() => {
    if (!preselect || !friends.data) return;
    const found = friends.data.find((f) => f.username === preselect);
    if (found) setSelected((current) => (current.length === 0 ? [found.userId] : current));
  }, [preselect, friends.data]);

  function change<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setResults(undefined);
    };
  }

  function toggle(userId: string) {
    setResults(undefined);
    setSelected((current) => (current.includes(userId) ? current.filter((id) => id !== userId) : current.length >= MAX_FRIENDS ? current : [...current, userId]));
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    const chosen = TURNS.find((t) => t.id === turn) ?? TURNS[0];
    const today = localDateKey(new Date());
    setLoading(true);
    setError(undefined);
    try {
      const response = await api.bestDates({
        friendIds: selected,
        fromDate: today,
        toDate: addDays(today, period - 1),
        durationMinutes: duration,
        earliestStart: chosen.earliest,
        latestStart: chosen.latest,
        timeZone: deviceTimeZone(),
        limit: 5,
      });
      setResults(response.items);
    } catch (failure) {
      setError(toApiError(failure).message);
    } finally {
      setLoading(false);
    }
  }

  const list = friends.data ?? [];
  return (
    <>
      <PageHead title="Encontrar melhor data" back="/agenda" subtitle="Escolha com quem e quando. O AskouT compara as agendas." />

      {friends.loading && !friends.data ? <Loading /> : null}
      {friends.error ? <ErrorState message={friends.error.message} onRetry={friends.reload} /> : null}
      {friends.data && list.length === 0 ? (
        <EmptyState
          title="Você ainda não tem amigos para comparar"
          action={
            <Link to="/explorar" className="btn btn--primary">
              Encontrar pessoas
            </Link>
          }
        >
          Amigos são pessoas que seguem você e que você segue de volta.
        </EmptyState>
      ) : null}

      {list.length > 0 ? (
        <form className="form form--flat" onSubmit={search}>
          <fieldset className="picks">
            <legend className="optgroup__label">Com quem ({selected.length} de {MAX_FRIENDS} no máximo)</legend>
            {list.map((friend) => {
              const on = selected.includes(friend.userId);
              return (
                <label key={friend.userId} className={`pick${on ? ' pick--on' : ''}`}>
                  <input type="checkbox" checked={on} onChange={() => toggle(friend.userId)} disabled={!on && selected.length >= MAX_FRIENDS} />
                  <Avatar profile={friend} size={36} />
                  <span className="pick__body">
                    <span className="person__name">{friend.username}</span>
                  </span>
                </label>
              );
            })}
          </fieldset>

          <Chips label="Período" options={PERIODS.map((p) => ({ value: p.days, label: p.label }))} value={period} onChange={change(setPeriod)} />
          <Chips label="Duração" options={DURATIONS.map((d) => ({ value: d.minutes, label: d.label }))} value={duration} onChange={change(setDuration)} />
          <Chips label="Horário de início" options={TURNS.map((t) => ({ value: t.id as string, label: t.label }))} value={turn} onChange={change(setTurn)} />

          {error ? <Notice tone="error">{error}</Notice> : null}
          <Button type="submit" full loading={loading} disabled={selected.length === 0}>
            Ver melhores horários
          </Button>
        </form>
      ) : null}

      {results ? (
        <section className="section results" aria-live="polite" aria-label="Resultados">
          {results.length === 0 ? (
            <EmptyState title="Nenhum horário nesse período">Tente um período maior ou outro horário de início.</EmptyState>
          ) : (
            <>
              <h2 className="section__title">Melhores horários</h2>
              <ul className="result-list">
                {results.map((result) => (
                  <ResultCard key={result.start} result={result} />
                ))}
              </ul>
              <p className="muted">Quem não marcou horários aparece como “sem informação”, nunca como indisponível.</p>
            </>
          )}
        </section>
      ) : null}
    </>
  );
}
