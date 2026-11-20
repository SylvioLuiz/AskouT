import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AgendaEvent } from '../lib/agenda.ts';
import type { FormEvent } from 'react';
import { DayStrip, LevelBadge, MonthCalendar, ParticipantMark, Sheet, StateMark } from '../components/agenda.tsx';
import { Avatar } from '../components/ui.tsx';
import { CalendarSyncSheet, refreshDeviceCalendarsIfDue } from '../components/calendar-sync.tsx';
import { busyColorsOnDay, busyOnDay, connectionColor, syncButtonLabel } from '../lib/calendar-sync.ts';
import type { BusyBlock, CalendarConnection } from '../lib/calendar-sync.ts';
import { CalendarIcon, ChevronRightIcon, ClockIcon, HelpIcon, LockIcon, PlusIcon, RefreshIcon, UsersIcon } from '../components/icons.tsx';
import { Button, Confirm, ErrorState, Field, Loading, Notice, PageHead } from '../components/ui.tsx';
import { api } from '../client.ts';
import { useAsync, useTitle } from '../hooks.ts';
import {
  PRESETS,
  STATE_HELP,
  addDays,
  addMonths,
  agendaEvents,
  agendaEventsOnDay,
  buildSlot,
  dayLongLabel,
  dayShortLabel,
  daysFrom,
  firstDayWith,
  deviceTimeZone,
  localDateKey,
  monthDays,
  nextEventDayAfter,
  rangeForDays,
  slotsOnDay,
  statesOnDay,
  timeRangeLabel,
} from '../lib/agenda.ts';
import { toApiError } from '../lib/errors.ts';
import { isoToLocalInput } from '../lib/post-draft.ts';
import type { Compatibility, PublicProfile, Slot, SlotState } from '../lib/types.ts';
import { Link, navigate, useSearch } from '../router.tsx';
import { intlLocale, t } from '../lib/i18n/index.ts';

/** Ao abrir, procura o primeiro dia com evento só nestes dias a partir de hoje. */
const OPEN_LOOKAHEAD_DAYS = 28;
const VIEW_KEY = 'askout.agenda.view';
const capitalize = (text: string) => text.charAt(0).toLocaleUpperCase('pt-BR') + text.slice(1);
const STATES: readonly SlotState[] = ['AVAILABLE', 'PARTIAL', 'UNAVAILABLE'];

/** A faixa mostra o mês do dia escolhido, qualquer que seja; trocar de mês busca os horários daquele mês. */
function useMonthWindow(selected: string) {
  const month = selected.slice(0, 7);
  const days = useMemo(() => monthDays(`${month}-01`), [month]);
  const range = useMemo(() => rangeForDays(days[0] as string, days.length), [days]);
  return { days, range };
}

function EventList({ events }: { events: AgendaEvent[] }) {
  return (
    <div className="agevents">
      <h3 className="agevents__title">{t('Eventos que você vai')}</h3>
      <ul className="agevents__list">
        {events.map((e) => (
          <li key={e.key}>
            <Link to={e.to} className="agevent">
              <span className="agevent__time">{new Date(e.startsAt).toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' })}</span>
              <span className="agevent__main">
                <strong>{e.title}</strong>
                {e.venueName ? <span className="muted">{e.venueName}</span> : null}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Compromissos das agendas ligadas: só "ocupado" e de qual agenda veio (o título nunca sai da agenda da pessoa). */
function BusyList({ blocks, day, colorOf }: { blocks: BusyBlock[]; day: string; colorOf: (block: BusyBlock) => string }) {
  return (
    <div className="agbusy">
      <h3 className="agevents__title">{t('Ocupado nas suas agendas')}</h3>
      <ul className="slots">
        {blocks.map((b) => (
          <li key={`${b.connectionId}-${b.start}`} className="slot slot--busy" style={{ borderLeftColor: colorOf(b) }}>
            <div className="slot__body">
              <span className="slot__time">{timeRangeLabel(b, day)}</span>
              <span className="agbusy__label">{t('Ocupado')} · {b.label}</span>
            </div>
            <Link
              to={`/criar?${new URLSearchParams({ tipo: 'evento', inicio: isoToLocalInput(b.start), fim: isoToLocalInput(b.end) }).toString()}`}
              className="btn btn--ghost btn--small"
              aria-label={t('Criar evento das {time}', { time: timeRangeLabel(b, day) })}
            >
              {t('Criar evento')}
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
            <Button variant="quiet" small onClick={() => onRemove(slot)} aria-label={t('Remover horário {day}', { day: timeRangeLabel(slot, day) })}>
              {t('Remover')}
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

// ---------- Horários em comum ----------

const COMMON_MAX_FRIENDS = 9;
const COMMON_DAYS = 14;

/** "Achar horário com amigos": escolhe amigos que mostram a agenda e vê o melhor horário de cada dia para todos. */
function CommonTimesSheet({ today, onClose }: { today: string; onClose: () => void }) {
  const friends = useAsync(() => api.sharingFriends(), []);
  const [picked, setPicked] = useState<string[]>([]);
  const [results, setResults] = useState<Compatibility[] | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const list: PublicProfile[] = friends.data?.friends ?? [];

  function toggle(id: string) {
    setResults(undefined);
    setPicked((current) => (current.includes(id) ? current.filter((x) => x !== id) : current.length >= COMMON_MAX_FRIENDS ? current : [...current, id]));
  }

  async function search() {
    setBusy(true);
    setError(undefined);
    try {
      // Dia em que ninguém marcou nada ("aguardando informações") não ajuda a escolher: fica de fora.
      const found = await api.bestDates({ friendIds: picked, fromDate: today, toDate: addDays(today, COMMON_DAYS - 1), durationMinutes: 120, earliestStart: '17:00', latestStart: '22:00', timeZone: deviceTimeZone(), limit: 20 });
      setResults(found.filter((r) => r.level !== 'awaiting').slice(0, 5));
    } catch (failure) {
      setError(toApiError(failure).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title={t('Achar horário com amigos')} onClose={onClose}>
      {friends.loading && !friends.data ? <Loading /> : null}
      {friends.error ? <ErrorState message={friends.error.message} onRetry={friends.reload} /> : null}
      {friends.data && list.length === 0 ? (
        <p className="muted">{t('Nenhum amigo mostra os horários ainda. Quando alguém ligar Mostrar meus horários para amigos na agenda, aparece aqui.')}</p>
      ) : null}
      {list.length > 0 ? (
        <>
          <p className="muted">{t('Escolha até {max} amigos. O app procura nos próximos {days} dias, entre 17h e 22h, o melhor horário de cada dia para todo mundo.', { max: COMMON_MAX_FRIENDS, days: COMMON_DAYS })}</p>
          <ul className="agcommon__friends">
            {list.map((f) => (
              <li key={f.userId}>
                <label className={`agcommon__friend${picked.includes(f.userId) ? ' agcommon__friend--on' : ''}`}>
                  <input type="checkbox" checked={picked.includes(f.userId)} onChange={() => toggle(f.userId)} disabled={!picked.includes(f.userId) && picked.length >= COMMON_MAX_FRIENDS} />
                  <Avatar profile={f} size={32} />
                  <span className="agcommon__name">
                    <strong>{f.displayName}</strong>
                    <span>@{f.username}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Button full loading={busy} disabled={picked.length === 0} onClick={() => void search()}>
            {t('Ver horários em comum')}
          </Button>
        </>
      ) : null}
      {results ? (
        results.length === 0 ? (
          <p className="muted agcommon__empty">{t('Nenhum horário bom nos próximos dias. Marquem horários na agenda e tentem de novo.')}</p>
        ) : (
          <ul className="agcommon__results" aria-label={t('Horários em comum')}>
            {results.map((r) => {
              const day = localDateKey(new Date(r.start));
              return (
                <li key={r.start} className="agcommon__result">
                  <div className="agcommon__when">
                    <strong>{capitalize(dayLongLabel(day))}</strong>
                    <span>{timeRangeLabel(r, day)}</span>
                  </div>
                  <LevelBadge level={r.level} />
                  <ul className="agcommon__people">
                    {r.participants.map((p) => (
                      <li key={p.profile.userId}>
                        <span>{p.isMe ? t('Você') : `@${p.profile.username}`}</span>
                        <ParticipantMark status={p.status} />
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        )
      ) : null}
    </Sheet>
  );
}

// ---------- Minha agenda ----------

/** "Como funciona?" da agenda: para que serve marcar horário e o que mais aparece nela. */
function AgendaHelp({ onClose }: { onClose: () => void }) {
  const rules: { icon: ReactNode; title: string; text: string }[] = [
    { icon: <ClockIcon />, title: t('Marcar horário'), text: t('Toque em Marcar horário, escolha o dia e o período e diga como você está: disponível (topo sair), parcial (talvez, ou só parte do tempo) ou indisponível.') },
    { icon: <PlusIcon />, title: t('Para que serve'), text: t('É o seu lembrete de quando dá para sair e, se você quiser, o jeito de mostrar aos amigos quando você topa.') },
    { icon: <LockIcon />, title: t('Você escolhe quem vê'), text: t('Começa só para você. Se ligar Mostrar meus horários para amigos, seus amigos veem quando você está livre e podem achar horários em comum com você. Dá para desligar quando quiser.') },
    { icon: <UsersIcon />, title: t('Horários em comum'), text: t('Toque em Achar horário com amigos, escolha quem vai e o app mostra o melhor horário de cada dia para todo mundo. Só entram amigos que também mostram os horários.') },
    { icon: <RefreshIcon />, title: t('Sincronizar agendas'), text: t('Ligue o Google Agenda (ou outra) para ver aqui os seus compromissos como ocupado. Só o horário vem: o nome do compromisso não sai do seu calendário.') },
    { icon: <CalendarIcon />, title: t('Seus eventos'), text: t('Os eventos em que você confirmou presença aparecem no dia deles, junto com os seus horários.') },
  ];
  return (
    <Sheet title={t('Como a agenda funciona')} onClose={onClose}>
      <ul className="nowhow">
        {rules.map((r) => (
          <li key={r.title}>
            <span className="nowhow__icon" aria-hidden="true">
              {r.icon}
            </span>
            <span>
              <strong>{r.title}</strong>
              <span>{r.text}</span>
            </span>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

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
    <Sheet title={t('Marcar horário')} onClose={onClose}>
      <form className="form form--flat" onSubmit={submit} noValidate>
        <p className="muted">{dayLongLabel(day)}</p>

        <fieldset className="choice">
          <legend className="choice__legend">{t('Como você está nesse período?')}</legend>
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

        <div className="chips" role="group" aria-label={t('Atalhos de horário')}>
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
          <Field label={t('Início')} type="time" value={start} onChange={setStart} error={errors['start']} />
          <Field label={t('Fim')} type="time" value={end} onChange={setEnd} error={errors['end']} hint={t('00:00 é meia-noite')} />
        </div>

        {formError ? <Notice tone="error">{formError}</Notice> : null}
        <Button type="submit" full loading={saving}>
          {t('Salvar horário')}
        </Button>
      </form>
    </Sheet>
  );
}

export function AgendaScreen() {
  useTitle(t('Agenda'));
  const today = useMemo(() => localDateKey(new Date()), []);
  const [selected, setSelected] = useState(today);
  const { days, range } = useMonthWindow(selected);
  const [picking, setPicking] = useState(false);
  /** Dia (faixa de dias) ou mês inteiro (grade); a escolha fica guardada neste aparelho. */
  const [view, setView] = useState<'day' | 'month'>(() => {
    try {
      return window.localStorage.getItem(VIEW_KEY) === 'month' ? 'month' : 'day';
    } catch {
      return 'day';
    }
  });
  function changeView(next: 'day' | 'month') {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Sem armazenamento: vale só até fechar a tela.
    }
  }
  /** De onde veio a troca de dia, para o conteúdo deslizar do lado certo. */
  const [direction, setDirection] = useState<'next' | 'prev' | 'none'>('none');
  /** Depois que a pessoa escolhe um dia, a tela não muda de dia sozinha. */
  const picked = useRef(false);
  const [adding, setAdding] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [finding, setFinding] = useState(false);
  const sharing = useAsync(() => api.availabilitySharing(), []);
  const shared = sharing.data?.sharing === true;
  const [syncing, setSyncing] = useState(false);
  const [syncedN, setSyncedN] = useState(0);
  const search = useSearch();
  /** Volta da Google Agenda / Outlook (site, ou o app aberto pelo link do navegador): abre a folha com o aviso e limpa o endereço. */
  const [syncNotice, setSyncNotice] = useState<{ tone: 'ok' | 'error'; text: string } | undefined>();
  const syncResult = search.get('agendas');
  useEffect(() => {
    const result = syncResult;
    if (!result) return;
    setSyncNotice(
      result === 'google' || result === 'microsoft'
        ? { tone: 'ok', text: t('{name} conectada. Escolha abaixo quais agendas entram.', { name: result === 'google' ? 'Google Agenda' : 'Outlook' }) }
        : { tone: 'error', text: search.get('motivo') || t('Não foi possível ligar a agenda.') },
    );
    setSyncing(true);
    calendars.reload();
    navigate('/agenda', { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncResult]);
  const busyBlocks = useAsync(() => api.calendarBusy(range.from, range.to).catch(() => [] as BusyBlock[]), [range.from, range.to]);
  const calendars = useAsync(() => api.calendarOverview().catch(() => undefined), []);
  useEffect(() => {
    const list = calendars.data?.connections;
    if (!list) return;
    setSyncedN(list.length);
    // No app: reenvia a agenda do celular ao abrir (no máximo a cada 30 min).
    void refreshDeviceCalendarsIfDue(list).then((changed) => {
      if (changed) busyBlocks.reload();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendars.data]);
  /** Agendas ligadas (atualizadas também quando a pessoa mexe na folha Sincronizar), para a cor de cada uma. */
  const [connections, setConnections] = useState<readonly CalendarConnection[]>([]);
  useEffect(() => {
    if (calendars.data) setConnections(calendars.data.connections);
  }, [calendars.data]);
  const colorByConnection = useMemo(() => new Map(connections.map((c) => [c.id, connectionColor(c)])), [connections]);
  const colorOf = (block: BusyBlock) => colorByConnection.get(block.connectionId) ?? connectionColor({ provider: block.provider, calendars: [] });
  const busyToday = busyOnDay(busyBlocks.data ?? [], selected);
  /** Mês aberto no "Ir para a data": busca os compromissos e horários dele para mostrar as bolinhas. */
  const [pickerMonth, setPickerMonth] = useState<string | undefined>();
  const pickerRange = useMemo(() => {
    if (!pickerMonth || !picking) return undefined;
    // A grade mostra até 6 dias dos meses vizinhos: busca uma semana a mais de cada lado.
    const first = addDays(pickerMonth, -7);
    return rangeForDays(first, monthDays(pickerMonth).length + 14);
  }, [pickerMonth, picking]);
  const pickerBusy = useAsync(
    () => (pickerRange ? api.calendarBusy(pickerRange.from, pickerRange.to).catch(() => [] as BusyBlock[]) : Promise.resolve([] as BusyBlock[])),
    [pickerRange?.from, pickerRange?.to],
  );
  const pickerSlots = useAsync(
    () => (pickerRange ? api.mySlots(pickerRange.from, pickerRange.to).catch(() => [] as Slot[]) : Promise.resolve([] as Slot[])),
    [pickerRange?.from, pickerRange?.to],
  );
  const [removing, setRemoving] = useState<Slot | undefined>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | undefined>();
  const slots = useAsync(() => api.mySlots(range.from, range.to), [range.from, range.to]);
  const all = slots.data ?? [];
  const ofDay = slotsOnDay(all, selected);
  const meetups = useAsync(() => api.myMeetups(), []);
  const goingEvents = useAsync(() => api.myGoingEvents(), []);
  const events = useMemo(() => agendaEvents(meetups.data?.items ?? [], goingEvents.data?.items ?? []), [meetups.data, goingEvents.data]);
  const eventsToday = agendaEventsOnDay(events, selected);
  const hasEvent = (key: string) => agendaEventsOnDay(events, key).length > 0;
  const eventsLoaded = !meetups.loading && !goingEvents.loading && (meetups.data !== undefined || goingEvents.data !== undefined);

  // Ao abrir, vai direto para o primeiro dia (de hoje em diante) que tem evento.
  useEffect(() => {
    if (!eventsLoaded || picked.current) return;
    picked.current = true;
    const first = firstDayWith(daysFrom(today, OPEN_LOOKAHEAD_DAYS), hasEvent);
    if (first) setSelected(first);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventsLoaded]);

  function choose(key: string) {
    picked.current = true;
    if (key === selected) return;
    setDirection(key > selected ? 'next' : 'prev');
    setSelected(key);
    setMessage(undefined);
    setRemoving(undefined);
  }

  function shift(by: number) {
    choose(addDays(selected, by));
  }

  /** Vai para outro mês: cai em hoje se for o mês atual, senão no dia 1. */
  function changeMonth(by: number) {
    const target = addMonths(selected, by);
    choose(target.slice(0, 7) === today.slice(0, 7) ? today : target);
  }

  const nextEventDay = nextEventDayAfter(events, selected);

  // Deslizar o dedo para os lados no conteúdo do dia troca de dia.
  const swipe = useRef<{ x: number; y: number } | undefined>(undefined);
  function onTouchStart(event: React.TouchEvent) {
    const touch = event.touches[0];
    swipe.current = event.touches.length === 1 && touch ? { x: touch.clientX, y: touch.clientY } : undefined;
  }
  function onTouchEnd(event: React.TouchEvent) {
    const start = swipe.current;
    const touch = event.changedTouches[0];
    swipe.current = undefined;
    if (!start || !touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    shift(dx < 0 ? 1 : -1);
  }

  async function remove(slot: Slot) {
    setBusy(true);
    setMessage(undefined);
    try {
      await api.removeSlot(slot.id);
      setRemoving(undefined);
      setMessage({ tone: 'ok', text: t('Horário removido.') });
      slots.reload();
    } catch (failure) {
      setMessage({ tone: 'error', text: toApiError(failure).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead
        title={t('Agenda')}
        subtitle={shared ? t('Seus amigos veem esta agenda. Marque quando topa sair.') : t('Só você vê esta agenda. Marque quando topa sair.')}
        action={
          <button type="button" className="nowhead__how" onClick={() => setHelpOpen(true)}>
            <HelpIcon />
            {t('Como funciona?')}
          </button>
        }
      />
      {helpOpen ? <AgendaHelp onClose={() => setHelpOpen(false)} /> : null}

      <Link to="/configuracao/agenda" className="agshare agshare--link" aria-label={t('Agenda com amigos: {state}. Mudar nas configurações.', { state: shared ? t('ligada') : t('desligada') })}>
        <div className="agshare__text">
          <h2 className="agshare__title">{t('Agenda com amigos')}</h2>
          <p className="agshare__help">{sharing.data === undefined ? t('Carregando…') : shared ? t('Ligada: seus amigos veem seus horários. Toque para mudar nas configurações.') : t('Desligada: só você vê seus horários. Toque para mudar nas configurações.')}</p>
        </div>
        <ChevronRightIcon />
      </Link>
      <Button variant="secondary" full onClick={() => setFinding(true)}>
        <UsersIcon /> {t('Achar horário com amigos')}
      </Button>
      {finding ? <CommonTimesSheet today={today} onClose={() => setFinding(false)} /> : null}

      <div className="agsync">
        <div className="agview" role="group" aria-label={t('Visualização da agenda')}>
          <button type="button" className={`agview__opt${view === 'day' ? ' agview__opt--on' : ''}`} aria-pressed={view === 'day'} onClick={() => changeView('day')}>
            {t('Dia')}
          </button>
          <button type="button" className={`agview__opt${view === 'month' ? ' agview__opt--on' : ''}`} aria-pressed={view === 'month'} onClick={() => changeView('month')}>
            {t('Mês')}
          </button>
        </div>
        <Button variant="quiet" small onClick={() => setSyncing(true)}>
          <RefreshIcon />
          {syncButtonLabel(syncedN)}
        </Button>
      </div>

      <DayStrip
        days={days}
        selected={selected}
        today={today}
        onSelect={choose}
        statesOf={(key) => statesOnDay(all, key)}
        eventsOf={(key) => agendaEventsOnDay(events, key).length}
        onMonth={changeMonth}
        onOpenCalendar={() => setPicking(true)}
        busyOf={(key) => busyColorsOnDay(busyBlocks.data ?? [], key, colorOf)}
        view={view}
      />

      <section
        key={selected}
        className={`section agday agday--${direction}`}
        aria-labelledby="dia-titulo"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <h2 id="dia-titulo" className="section__title section__title--day">
          {capitalize(dayLongLabel(selected))}
          {selected === today ? <span className="today-tag">{t('hoje')}</span> : null}
        </h2>

        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        {slots.loading && !slots.data ? <Loading /> : null}
        {slots.error ? <ErrorState message={slots.error.message} onRetry={slots.reload} /> : null}

        {slots.data && ofDay.length === 0 && busyToday.length === 0 ? (
          <p className="muted">{t('Nenhum horário marcado neste dia.')}</p>
        ) : null}
        {ofDay.length > 0 ? <SlotList slots={ofDay} day={selected} onRemove={(slot) => setRemoving(slot)} /> : null}
        {busyToday.length > 0 ? <BusyList blocks={busyToday} day={selected} colorOf={colorOf} /> : null}
        {eventsToday.length > 0 ? <EventList events={eventsToday} /> : null}
        {eventsLoaded && eventsToday.length === 0 && nextEventDay ? (
          <button type="button" className="agjump" onClick={() => choose(nextEventDay)}>
            <span className="agjump__label">{t('Próximo evento')}</span>
            <span className="agjump__day">{dayShortLabel(nextEventDay, nextEventDay.slice(0, 4) !== selected.slice(0, 4))}</span>
            <ChevronRightIcon />
          </button>
        ) : null}
        {removing ? (
          <Confirm
            question={t('Remover o horário {selected}?', { selected: timeRangeLabel(removing, selected) })}
            confirmLabel={t('Remover')}
            danger
            busy={busy}
            onCancel={() => setRemoving(undefined)}
            onConfirm={() => remove(removing)}
          />
        ) : null}
      </section>

      <button type="button" className="fab" onClick={() => setAdding(true)}>
        <PlusIcon />
        {t('Marcar horário')}
      </button>

      {syncing ? (
        <CalendarSyncSheet
          key={syncNotice?.text ?? 'sync'}
          notice={syncNotice}
          onClose={() => {
            setSyncing(false);
            setSyncNotice(undefined);
            busyBlocks.reload();
          }}
          onChange={(o) => {
            setSyncedN(o.connections.length);
            setConnections(o.connections);
            busyBlocks.reload();
          }}
        />
      ) : null}

      {picking ? (
        <Sheet title={t('Ir para a data')} onClose={() => setPicking(false)}>
          <MonthCalendar
            selected={selected}
            today={today}
            onMonthShown={setPickerMonth}
            legend={connections.filter((c) => c.status === 'ACTIVE').map((c) => ({ color: connectionColor(c), label: c.label }))}
            marksOf={(key) => {
              const inMain = key.slice(0, 7) === selected.slice(0, 7);
              const slotList = inMain ? all : (pickerSlots.data ?? []);
              const busyList = inMain ? (busyBlocks.data ?? []) : (pickerBusy.data ?? []);
              return { event: hasEvent(key), slot: statesOnDay(slotList, key).length > 0, busy: busyColorsOnDay(busyList, key, colorOf) };
            }}
            onSelect={(key) => {
              choose(key);
              setPicking(false);
            }}
          />
        </Sheet>
      ) : null}

      {adding ? (
        <AddSlotSheet
          day={selected}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            setMessage({ tone: 'ok', text: t('Horário salvo.') });
            slots.reload();
          }}
        />
      ) : null}
    </>
  );
}
