import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Sheet } from '../components/agenda.tsx';
import { RangeCalendar, POLICY_TEXT } from '../components/date-poll-create.tsx';
import { EditIcon } from '../components/icons.tsx';
import './date-poll-steps.css';
import '../components/date-poll-times.css';
import { Avatar, Button, Confirm, ErrorState, Field, Loading, Notice, PageHead, PageHeadSkeleton } from '../components/ui.tsx';
import { api } from '../client.ts';
import { useAsync, usePolling, useTitle } from '../hooks.ts';
import { agendaEvents, agendaEventsOnDay } from '../lib/agenda.ts';
import type { AgendaEvent } from '../lib/agenda.ts';
import { CONFIRMATION_LABEL, LEVEL_LABEL, chipDay, confirmStepText, dayInZone, POLICY_LABEL, VOTE_LABEL, VOTE_MARK, calendarWeeks, cellLabel, longDay, monthTitle, percent, podiumDay, shortDay, timeOf } from '../lib/date-poll.ts';
import type { ConfirmationAnswer, DateStats, PollView, VoteStatus } from '../lib/date-poll.ts';
import { toApiError } from '../lib/errors.ts';
import { isoToLocalInput } from '../lib/post-draft.ts';
import { Link, navigate } from '../router.tsx';
import { intlLocale, t } from '../lib/i18n/index.ts';

const WEEK_HEAD = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const BRUSHES: VoteStatus[] = ['YES', 'MAYBE', 'NO'];
type Brush = VoteStatus | 'CLEAR';
type Tab = 'mine' | 'group';

export function DatePollScreen({ pollId }: { pollId: string }) {
  const load = useAsync(() => api.poll(pollId), [pollId]);
  const [poll, setPoll] = useState<PollView | undefined>();
  useEffect(() => {
    if (load.data) setPoll(load.data);
  }, [load.data]);
  usePolling(load.reload, 15_000);
  useTitle(poll?.title ?? t('Encontrar a melhor data'));

  if (!poll) {
    if (load.error) return <ErrorState message={load.error.message} onRetry={load.reload} />;
    return (<><PageHeadSkeleton subtitle back="/conversas" /><Loading shape="cards" rows={3} /></>);
  }
  return <PollBody poll={poll} setPoll={setPoll} />;
}

function PollBody({ poll, setPoll }: { poll: PollView; setPoll: (p: PollView) => void }) {
  const [tab, setTab] = useState<Tab>(poll.status === 'VOTING' ? 'mine' : 'group');
  const [brush, setBrush] = useState<Brush>('YES');
  const [selected, setSelected] = useState<string | undefined>();
  const [selectedTime, setSelectedTime] = useState<string | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<'cancel' | undefined>();
  const [showAll, setShowAll] = useState(false);
  const [bestDismissed, setBestDismissed] = useState(false);
  const [editing, setEditing] = useState(false);
  // Com a data já proposta, os votos ficam recolhidos: o que importa agora é confirmar a data.
  const [votesOpen, setVotesOpen] = useState(false);
  // Dias em que você já tem compromisso (encontros e eventos confirmados ou criados por você).
  const myMeetups = useAsync(() => api.myMeetups(), []);
  const myGoing = useAsync(() => api.myGoingEvents(), []);
  const commitments = useMemo(() => agendaEvents(myMeetups.data?.items ?? [], myGoing.data?.items ?? []), [myMeetups.data, myGoing.data]);
  const eventsOn = (date: string): AgendaEvent[] => agendaEventsOnDay(commitments, date);
  // Aviso antes de dizer "posso" num dia que já tem compromisso.
  const [conflict, setConflict] = useState<{ dates: string[]; busyDays: { date: string; events: AgendaEvent[] }[] } | undefined>();
  // Os toques viram pedidos em fila, para a resposta mais velha não apagar a mais nova.
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const canVote = poll.votingOpen;
  // O que se vota: os dias, os horários (dia já definido) ou os dois.
  const votesDays = poll.mode !== 'BEST_TIME';
  const votesTimes = poll.mode === 'BEST_TIME' || poll.mode === 'BEST_DATE_TIME';
  const times = poll.times ?? [];
  const timeRanking = poll.timeRanking ?? [];
  // Todos já votaram (ou os votos acabaram): quem organiza vê a melhor opção e confirma o evento de uma vez.
  const ready = poll.isOrganizer && poll.status === 'VOTING' && (poll.votingClosed || poll.canClose) && poll.enoughData;
  const bestDay = votesDays ? poll.ranking[0] : undefined;
  const bestTime = votesTimes ? timeRanking[0] : undefined;
  const best = ready && (!votesDays || bestDay) && (!votesTimes || bestTime) ? { day: bestDay?.date ?? poll.rangeStart, time: bestTime?.date, stats: bestDay ?? bestTime! } : undefined;
  const byDate = new Map(poll.days.map((d) => [d.date, d] as const));
  const byTime = new Map(times.map((d) => [d.date, d] as const));
  /** "sábado, 24 de outubro", com o horário quando a votação vota horário. */
  const whenLabel = (day: string, time: string | undefined) => (time ? `${longDay(day)}, ${time}` : longDay(day));

  function run(work: () => Promise<PollView>) {
    setProblem(undefined);
    queue.current = queue.current
      .then(work)
      .then((next) => setPoll(next))
      .catch((failure) => setProblem(toApiError(failure).message));
    return queue.current;
  }

  function paint(dates: string[]) {
    void run(() => api.votePoll(poll.id, brush, dates));
  }

  async function act(work: () => Promise<PollView>) {
    setBusy(true);
    await run(work);
    setBusy(false);
  }

  function askOrPaint(dates: string[]) {
    const busyDays = brush === 'YES' ? dates.flatMap((date) => { const events = eventsOn(date); return events.length > 0 ? [{ date, events }] : []; }) : [];
    if (busyDays.length === 0) paint(dates);
    else setConflict({ dates, busyDays });
  }

  function tapDay(date: string) {
    setSelected(date);
    if (tab === 'mine' && canVote) askOrPaint([date]);
  }

  function tapTime(time: string) {
    setSelectedTime(time);
    if (tab === 'mine' && canVote) paint([time]);
  }

  const selectedStats = selected ? byDate.get(selected) : undefined;
  const selectedTimeStats = selectedTime ? byTime.get(selectedTime) : undefined;
  // Proposta de quem organiza: o dia escolhido (ou o da votação) e o horário escolhido (quando se vota horário).
  const proposeDay = votesDays ? selected : poll.rangeStart;
  const proposeTime = votesTimes ? selectedTime : undefined;
  const canPropose = poll.isOrganizer && poll.status === 'VOTING' && (selected !== undefined || selectedTime !== undefined);
    const finished = poll.participants.filter((p) => p.finished).length;
  const weeks = calendarWeeks(poll.rangeStart, poll.rangeEnd);
  // Votação de evento: quem ainda não aceitou ("Eu vou") vota sem estar no grupo, e volta para o evento.
  const outsideGroup = poll.inConversation === false && Boolean(poll.eventPostId);
  const backTo = outsideGroup ? `/eventos/${encodeURIComponent(poll.eventPostId ?? "")}` : `/conversas/${poll.conversationId}`;
  const allDays = poll.days.map((d) => d.date);

  return (
    <div className="dpoll">
      <PageHead title={poll.title} back={backTo} subtitle={votesDays ? `${shortDay(poll.rangeStart)} a ${shortDay(poll.rangeEnd)}` : t('{day}: votação de horário', { day: longDay(poll.rangeStart) })}
        action={
          poll.isOrganizer && poll.status === 'VOTING' && !poll.votingClosed ? (
            <button type="button" className="iconbtn" aria-label={t('Editar votação')} onClick={() => setEditing(true)}>
              <EditIcon />
            </button>
          ) : undefined
        }
      />
      {editing ? <EditPollSheet poll={poll} onClose={() => setEditing(false)} onSaved={(p) => { setPoll(p); setEditing(false); }} /> : null}
      {problem ? <Notice tone="error">{problem}</Notice> : null}
      {poll.status !== 'CANCELLED' ? <PollSteps status={poll.status} /> : null}

      {poll.status === 'FINALIZED' && poll.final ? (
        <section className="callout dpoll__final" aria-label={t('Data definida')}>
          <p className="callout__text">
            <strong>{t('Data definida: {day}', { day: longDay(poll.final.date) })}</strong>
            <br />
            {new Date(poll.final.startsAt).toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit', timeZone: poll.timezone })} {t('às')} {new Date(poll.final.endsAt).toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit', timeZone: poll.timezone })}
          </p>
          <div className="row-actions">
            {poll.final.meetupId ? (
              <Link to="/agenda" className="btn btn--secondary btn--small">
                {t('Ver na agenda')}
              </Link>
            ) : null}
            <Link to={backTo} className="btn btn--secondary btn--small">
              {outsideGroup ? t('Ver o evento') : t('Voltar à conversa')}
            </Link>
            {poll.isOrganizer ? (
              <Link to={`/criar?${new URLSearchParams({ votacao: poll.id, titulo: poll.title, inicio: isoToLocalInput(poll.final.startsAt), fim: isoToLocalInput(poll.final.endsAt), conversa: poll.conversationId }).toString()}`} className="btn btn--primary btn--small">
                {t('Transformar em evento')}
              </Link>
            ) : null}
          </div>
        </section>
      ) : null}
      {poll.status === 'VOTING' && poll.votingClosed ? <Notice>{t('Os votos foram encerrados.')} {poll.isOrganizer ? t('Escolha a data entre as melhores abaixo.') : t('Aguarde quem organiza escolher a data.')}</Notice> : null}
      {best && bestDismissed ? (
        <div className="callout">
          <p className="callout__text">
            <strong>{t('Melhor opção: {date}', { date: whenLabel(best.day, best.time) })}</strong>
          </p>
          <Button small onClick={() => setBestDismissed(false)}>
            {votesTimes ? t('Confirmar a melhor opção') : t('Confirmar melhor data')}
          </Button>
        </div>
      ) : null}
      {poll.canClose ? (
        <div className="callout">
          <p className="callout__text">
            <strong>{t('Todos já votaram.')}</strong> Você pode encerrar a votação agora e escolher a data.
          </p>
          <Button small loading={busy} onClick={() => act(() => api.closePoll(poll.id))}>
            {t('Encerrar votação')}
          </Button>
        </div>
      ) : null}
      {poll.status === 'CANCELLED' ? <Notice>{t('Esta votação foi cancelada.')}</Notice> : null}

      {poll.proposal && poll.status === 'CONFIRMING' ? <ProposalCard poll={poll} busy={busy} act={act} /> : null}

      {poll.status === 'CONFIRMING' ? (
        <Button variant="quiet" small aria-expanded={votesOpen} onClick={() => setVotesOpen((v) => !v)}>
          {votesOpen ? t('Esconder votos do grupo') : t('Ver votos do grupo')}
        </Button>
      ) : null}
      {poll.status !== 'CONFIRMING' || votesOpen ? (
      <>
      <p className="dpoll__meta muted">
        {POLICY_LABEL[poll.confirmationPolicy]}
        {poll.votingClosed ? t(' · votos encerrados') : poll.votingDeadline ? t(' · votação até {when}', { when: new Date(poll.votingDeadline).toLocaleString(intlLocale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) }) : ''}
        {' · '}
        {t('{done} de {total} concluíram', { done: finished, total: poll.participants.length })}
      </p>

      <div className="segtabs" role="tablist" aria-label={t('Visão do calendário')}>
        <button type="button" role="tab" aria-selected={tab === 'mine'} className="segtabs__tab" onClick={() => setTab('mine')}>
          {t('Meu voto')}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'group'} className="segtabs__tab" onClick={() => setTab('group')}>
          {t('Mapa do grupo')}
        </button>
      </div>

      {tab === 'mine' && canVote ? (
        <div className="dpoll__brushes" role="group" aria-label={t('Escolha uma resposta e toque nos dias')}>
          {BRUSHES.map((b) => (
            <button key={b} type="button" className={`dpoll__brush dpoll__brush--${b}`} aria-pressed={brush === b} onClick={() => setBrush(b)}>
              <span aria-hidden="true">{VOTE_MARK[b]}</span> {VOTE_LABEL[b]}
            </button>
          ))}
          <button type="button" className="dpoll__brush dpoll__brush--CLEAR" aria-pressed={brush === 'CLEAR'} onClick={() => setBrush('CLEAR')}>
            {t('Limpar')}
          </button>
        </div>
      ) : null}
      {tab === 'mine' && canVote ? (
        <div className="row-actions">
          {votesDays ? (
            <Button small variant="quiet" onClick={() => askOrPaint(allDays)}>
              {t('Aplicar a todos os dias')}
            </Button>
          ) : null}
          {votesTimes ? (
            <Button small variant="quiet" onClick={() => paint(times.map((x) => x.date))}>
              {t('Aplicar a todos os horários')}
            </Button>
          ) : null}
        </div>
      ) : null}
      {tab === 'mine' && !canVote && poll.status === 'VOTING' ? <Notice>{t('O prazo da votação acabou.')}</Notice> : null}

      {votesDays ? (
      <>
      {votesTimes ? <h2 className="dpoll__h">{t('Dias')}</h2> : null}
      <div className="dpcal" role="grid" aria-label={t('Calendário de {rangeStart}', { rangeStart: monthTitle(poll.rangeStart) })}>
        <div className="dpcal__head" role="row">
          {WEEK_HEAD.map((w, i) => (
            <span key={i} role="columnheader">
              {w}
            </span>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div key={wi} className="dpcal__week" role="row">
            {week.map((date, di) => {
              if (!date) return <span key={di} className="dpcal__cell dpcal__cell--out" role="gridcell" />;
              const stats = byDate.get(date)!;
              const mine = poll.myVotes[date];
              const busyEvents = eventsOn(date);
              const cls =
                tab === 'mine'
                  ? `dpcal__cell dpcal__cell--${mine ?? 'NONE'}`
                  : `dpcal__cell dpcal__cell--L${stats.level}`;
              return (
                <button key={di} type="button" role="gridcell" className={`${cls}${selected === date ? ' is-selected' : ''}`} aria-label={`${cellLabel(stats, mine)}${busyEvents.length > 0 ? t(', você já tem compromisso: {titles}', { titles: busyEvents.map((e) => e.title).join(', ') }) : ''}`} aria-selected={selected === date} onClick={() => tapDay(date)}>
                  {busyEvents.length > 0 ? <span className="dpcal__busy" aria-hidden="true" /> : null}
                  <span className="dpcal__day">{Number(date.slice(8, 10))}</span>
                  {tab === 'mine' ? (
                    <span className="dpcal__mark" aria-hidden="true">
                      {mine ? VOTE_MARK[mine] : ''}
                    </span>
                  ) : (
                    <span className="dpcal__mark" aria-hidden="true">
                      {stats.compatibility === null ? '' : percent(stats.compatibility)}
                      {stats.lowCoverage && stats.compatibility !== null ? '*' : ''}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {tab === 'group' ? (
        <p className="dpoll__legend muted">
          Verde {poll.thresholds.green}% ou mais · laranja {poll.thresholds.orange}% a {poll.thresholds.green - 1}% · vermelho abaixo · cinza: poucos votos. * = menos de {poll.thresholds.minCoverage}% responderam.
        </p>
      ) : (
        <p className="dpoll__legend muted">{t('Dia sem marca fica “sem resposta” e não conta como “não posso”.')}</p>
      )}

      {allDays.some((d) => eventsOn(d).length > 0) ? (
        <p className="dpoll__legend muted">
          <span className="dpoll__busyicon" aria-hidden="true" /> {t('Você já tem evento ou compromisso neste dia.')}
        </p>
      ) : null}
      </>
      ) : null}

      {votesTimes ? (
        <section aria-labelledby="dpoll-times">
          <h2 id="dpoll-times" className="dpoll__h">
            {votesDays ? t('Horários') : t('Horários de {day}', { day: longDay(poll.rangeStart) })}
          </h2>
          <ul className="dptimes">
            {times.map((stats) => {
              const mine = poll.myVotes[stats.date];
              const cls = tab === 'mine' ? `dptimes__row dptimes__row--${mine ?? 'NONE'}` : `dptimes__row dptimes__row--L${stats.level}`;
              return (
                <li key={stats.date}>
                  <button type="button" className={`${cls}${selectedTime === stats.date ? ' is-selected' : ''}`} aria-pressed={selectedTime === stats.date} aria-label={`${stats.date}, ${mine ? t('sua resposta: {answer}', { answer: VOTE_LABEL[mine] }) : t('sem resposta sua')}, ${stats.compatibility === null ? t('sem votos') : t('{compat} de compatibilidade', { compat: percent(stats.compatibility) })}`} onClick={() => tapTime(stats.date)}>
                    <span className="dptimes__time">{stats.date}</span>
                    <span className="dptimes__info">{t('{yes} posso, {maybe} talvez, {no} não posso', { yes: stats.yes, maybe: stats.maybe, no: stats.no })}</span>
                    <span className="dptimes__mark" aria-hidden="true">
                      {tab === 'mine' ? (mine ? VOTE_MARK[mine] : '') : stats.compatibility === null ? '' : `${percent(stats.compatibility)}${stats.lowCoverage ? '*' : ''}`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {!votesDays ? <p className="dpoll__legend muted">{tab === 'mine' ? t('Horário sem marca fica “sem resposta” e não conta como “não posso”.') : t('Verde {green}% ou mais · laranja {orange}% a {greenBelow}% · vermelho abaixo · cinza: poucos votos.', { green: poll.thresholds.green, orange: poll.thresholds.orange, greenBelow: poll.thresholds.green - 1 })}</p> : null}
        </section>
      ) : null}

      {selectedStats ? <DayDetail stats={selectedStats} title={longDay(selectedStats.date)} /> : null}
      {selectedTimeStats ? <DayDetail stats={selectedTimeStats} title={votesDays ? t('Às {time}', { time: selectedTimeStats.date }) : whenLabel(poll.rangeStart, selectedTimeStats.date)} /> : null}
      {canPropose ? (
        <div className="dpoll__propose">
          {proposeDay && (!votesTimes || proposeTime) ? (
            <Button full loading={busy} onClick={() => void act(() => api.proposePoll(poll.id, proposeDay, proposeTime))}>
              {t('Propor {when}', { when: whenLabel(proposeDay, proposeTime) })}
            </Button>
          ) : (
            <p className="muted">{proposeDay ? t('Escolha também um horário para propor.') : t('Escolha também um dia para propor.')}</p>
          )}
        </div>
      ) : null}

      {canVote ? (
        <div className="dpoll__finish">
          {poll.iFinished ? (
            <>
              <p className="dpoll__done">✓ {t('Você concluiu sua votação. Pode mudar os votos até o encerramento.')}</p>
              <Button small variant="secondary" loading={busy} onClick={() => act(() => api.finishPoll(poll.id, false))}>
                {t('Reabrir minha votação')}
              </Button>
            </>
          ) : (
            <Button full loading={busy} onClick={() => act(() => api.finishPoll(poll.id, true))}>
              {t('Concluí minha votação')}
            </Button>
          )}
        </div>
      ) : null}

      {votesTimes ? (
        <section aria-labelledby="dpoll-trank">
          <h2 id="dpoll-trank" className="dpoll__h">
            {t('Melhores horários')}
          </h2>
          {timeRanking.length === 0 ? (
            <p className="muted">{t('Ainda faltam respostas para sugerir um horário.')}</p>
          ) : (
            <ol className="dpoll__rank">
              {timeRanking.slice(0, 3).map((d, i) => (
                <li key={d.date}>
                  <button type="button" className="dpoll__rankrow" onClick={() => { setSelectedTime(d.date); setTab('group'); }}>
                    <span className="dpoll__pos">{i === 0 ? '👑' : `${i + 1}º`}</span>
                    <span className="dpoll__rankmain">
                      <strong>{d.date}</strong>
                      <span className="muted">
                        {t('{compat} de compatibilidade · {coverage} votaram · {yes} posso, {maybe} talvez, {no} não posso', { compat: percent(d.compatibility), coverage: percent(d.coverage), yes: d.yes, maybe: d.maybe, no: d.no })}
                      </span>
                    </span>
                    <span className={`dpoll__badge dpoll__badge--${d.level}`}>{LEVEL_LABEL[d.level]}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>
      ) : null}

      {votesDays ? (
      <section aria-labelledby="dpoll-rank">
        <h2 id="dpoll-rank" className="dpoll__h">
          {t('Melhores datas')}
        </h2>
        {!(votesTimes ? poll.ranking.some((d) => !d.lowCoverage) : poll.enoughData) ? (
          <p className="muted">{t('Ainda faltam respostas para sugerir uma data. Peça para o pessoal votar.')}</p>
        ) : (
          <>
            <ol className="dpoll__podium" aria-label={t('Três melhores datas')}>
              {[1, 0, 2].map((i) => {
                const d = poll.ranking[i];
                if (!d) return <li key={i} className="dpoll__pcol dpoll__pcol--empty" aria-hidden="true" />;
                return (
                  <li key={d.date} className={`dpoll__pcol dpoll__pcol--${i + 1}`}>
                    <button type="button" className="dpoll__pbtn" onClick={() => { setSelected(d.date); setTab('group'); }} aria-label={t('{i}º lugar: {date}, {compatibility} de compatibilidade', { i: i + 1, date: longDay(d.date), compatibility: percent(d.compatibility) })}>
                      {i === 0 ? <span className="dpoll__crown" aria-hidden="true">👑</span> : <span className="dpoll__ppos" aria-hidden="true">{i + 1}º</span>}
                      <span className="dpoll__pday">{podiumDay(d.date)}</span>
                      <span className="dpoll__ppct">{percent(d.compatibility)}{i === 0 ? t(' compatível') : ''}</span>
                      <span className="dpoll__pblock" aria-hidden="true">{i + 1}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
            {poll.ranking[0] ? (
              <p className="dpoll__psum">
                <span className={`dpoll__badge dpoll__badge--${poll.ranking[0].level}`}>{LEVEL_LABEL[poll.ranking[0].level]}</span>
                <span>
                  {t('{yes} posso, {maybe} talvez, {no} não posso. Toque em uma data para ver quem pode.', { yes: poll.ranking[0].yes, maybe: poll.ranking[0].maybe, no: poll.ranking[0].no })}
                </span>
              </p>
            ) : null}
            {showAll && poll.ranking.length > 3 ? (
              <ol className="dpoll__rank" start={4}>
                {poll.ranking.slice(3).map((d, i) => (
                  <li key={d.date}>
                    <button type="button" className="dpoll__rankrow" onClick={() => { setSelected(d.date); setTab('group'); }}>
                      <span className="dpoll__pos">{i + 4}º</span>
                      <span className="dpoll__rankmain">
                        <strong>{longDay(d.date)}</strong>
                        <span className="muted">
                          {t('{compat} de compatibilidade · {coverage} votaram · {yes} posso, {maybe} talvez, {no} não posso', { compat: percent(d.compatibility), coverage: percent(d.coverage), yes: d.yes, maybe: d.maybe, no: d.no })}
                        </span>
                      </span>
                      <span className={`dpoll__badge dpoll__badge--${d.level}`}>{LEVEL_LABEL[d.level]}</span>
                    </button>
                  </li>
                ))}
              </ol>
            ) : null}
            {poll.ranking.length > 3 ? (
              <Button small variant="quiet" onClick={() => setShowAll((v) => !v)}>
                {showAll ? t('Ver só as 3 melhores') : t('Ver todas as datas')}
              </Button>
            ) : null}
          </>
        )}
      </section>
      ) : null}
      </>
      ) : null}

      <section aria-labelledby="dpoll-people">
        <h2 id="dpoll-people" className="dpoll__h">
          {poll.status === 'CONFIRMING' ? t('Quem confirmou') : t('Quem vota')}
        </h2>
        <ul className="dpoll__people">
          {poll.participants.map((p) => (
            <li key={p.profile.userId}>
              <Avatar profile={p.profile} size={32} />
              <span>{p.profile.displayName}</span>
              <span className="muted">
                {poll.status === 'CONFIRMING' ? (p.confirmation ? CONFIRMATION_LABEL[p.confirmation] : t('ainda não respondeu')) : p.finished ? t('concluiu') : t('ainda votando')}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {poll.history.length > 0 ? (
        <section aria-labelledby="dpoll-hist">
          <h2 id="dpoll-hist" className="dpoll__h">
            {t('Histórico')}
          </h2>
          <ul className="dpoll__hist">
            {poll.history.map((h) => (
              <li key={h.id}>
                {votesTimes ? whenLabel(h.date, timeOf(h.startsAt, poll.timezone)) : longDay(h.date)} — {h.status === 'CONFIRMED' ? t('confirmada') : h.status === 'REJECTED' ? t('não passou') : t('retirada')}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {poll.isOrganizer && (poll.status === 'VOTING' || poll.status === 'CONFIRMING') ? (
        confirming === 'cancel' ? (
          <Confirm danger question={t('Cancelar esta votação? Os votos ficam guardados, mas ninguém mais pode votar.')} confirmLabel={t('Cancelar votação')} busy={busy} onCancel={() => setConfirming(undefined)} onConfirm={() => void act(async () => {
            const next = await api.cancelPoll(poll.id);
            navigate(backTo);
            return next;
          }).then(() => setConfirming(undefined))} />
        ) : (
          <Button variant="quiet" onClick={() => setConfirming('cancel')}>
            {t('Cancelar votação')}
          </Button>
        )
      ) : null}
      {best && !bestDismissed ? (
        <Sheet title={votesTimes ? t('Todos votaram: melhor opção') : t('Todos votaram: melhor data')} onClose={() => setBestDismissed(true)}>
          {votesTimes ? (
            <BestOption label={whenLabel(best.day, best.time)} stats={best.stats} busy={busy} onConfirm={() => void act(() => api.confirmBestPoll(poll.id, best.day, best.time))} onLater={() => setBestDismissed(true)} />
          ) : (
            <BestDate poll={poll} best={best.stats} busy={busy} onConfirm={() => void act(() => api.confirmBestPoll(poll.id, best.day))} onLater={() => setBestDismissed(true)} />
          )}
        </Sheet>
      ) : null}
      {conflict ? (
        <Sheet title={conflict.busyDays.length === 1 ? t('Você já tem um evento nesse dia') : t('Você já tem eventos nesses dias')} onClose={() => setConflict(undefined)}>
          <div className="dpconflict">
            <ul className="dpconflict__list">
              {conflict.busyDays.map(({ date, events }) => (
                <li key={date}>
                  <strong>{longDay(date)}</strong>
                  <span>{events.map((e) => e.title).join(', ')}</span>
                </li>
              ))}
            </ul>
            <p className="muted">{t('Quer dizer que pode mesmo assim?')}</p>
            <Button
              full
              onClick={() => {
                const dates = conflict.dates;
                setConflict(undefined);
                paint(dates);
              }}
            >
              {t('Confirmar presença mesmo assim')}
            </Button>
            {conflict.dates.length > conflict.busyDays.length ? (
              <Button
                full
                variant="secondary"
                onClick={() => {
                  const busy = new Set(conflict.busyDays.map((d) => d.date));
                  const free = conflict.dates.filter((d) => !busy.has(d));
                  setConflict(undefined);
                  paint(free);
                }}
              >
                {t('Só nos dias livres')}
              </Button>
            ) : null}
            <Button full variant="quiet" onClick={() => setConflict(undefined)}>
              {t('Cancelar')}
            </Button>
          </div>
        </Sheet>
      ) : null}
    </div>
  );
}

/** Popup de quem organiza: a data campeã do ranking e o botão que cria o evento já com quem pode e quem talvez, confirmados. */
function BestDate({ poll, best, busy, onConfirm, onLater }: { poll: PollView; best: DateStats; busy: boolean; onConfirm: () => void; onLater: () => void }) {
  const mine = poll.myVotes[best.date];
  const going = best.yes + best.maybe + (mine === 'YES' || mine === 'MAYBE' ? 0 : 1);
  const others = poll.ranking.slice(1, 3);
  return (
    <div className="dpbest">
      <p className="dpbest__date">
        <span aria-hidden="true">👑</span> <strong>{longDay(best.date)}</strong>
      </p>
      <p className="muted">
        {percent(best.compatibility)} {t('de compatibilidade')} · {t('{yes} posso, {maybe} talvez, {no} não posso', { yes: best.yes, maybe: best.maybe, no: best.no })}
      </p>
      <p>{t('Ao confirmar, o evento é criado com {n} pessoas já confirmadas: quem votou “posso” ou “talvez” nesta data. Quem não pode fica de fora.', { n: going })}</p>
      {others.length > 0 ? (
        <ol className="dpbest__others" start={2}>
          {others.map((d, i) => (
            <li key={d.date}>
              <span className="muted">{i + 2}º</span> {longDay(d.date)} <span className="muted">{percent(d.compatibility)}</span>
            </li>
          ))}
        </ol>
      ) : null}
      <Button full loading={busy} onClick={onConfirm}>
        {t('Confirmar esta data e criar o evento')}
      </Button>
      <Button full variant="quiet" disabled={busy} onClick={onLater}>
        {t('Ver outras datas')}
      </Button>
    </div>
  );
}

/** Popup de quem organiza numa votação com horário: a melhor combinação de dia e horário. */
function BestOption({ label, stats, busy, onConfirm, onLater }: { label: string; stats: DateStats; busy: boolean; onConfirm: () => void; onLater: () => void }) {
  return (
    <div className="dpbest">
      <p className="dpbest__date">
        <span aria-hidden="true">👑</span> <strong>{label}</strong>
      </p>
      <p className="muted">
        {percent(stats.compatibility)} {t('de compatibilidade')}
      </p>
      <p>{t('Ao confirmar, o evento é criado já com quem votou “posso” ou “talvez” nesse dia e nesse horário. Quem não pode fica de fora.')}</p>
      <Button full loading={busy} onClick={onConfirm}>
        {t('Confirmar e criar o evento')}
      </Button>
      <Button full variant="quiet" disabled={busy} onClick={onLater}>
        {t('Ver outras opções')}
      </Button>
    </div>
  );
}

function DayDetail({ stats, title }: { stats: DateStats; title: string }) {
  return (
    <section className="dpoll__detail" aria-label={t('Detalhes de {date}', { date: title })}>
      <h2 className="dpoll__h">{title}</h2>
      <div className="dpoll__top">
        <div className="dpoll__ring" style={{ '--v': Math.max(0, Math.min(100, stats.compatibility ?? 0)) } as CSSProperties} role="img" aria-label={stats.compatibility === null ? t('Compatibilidade: sem votos') : t('Compatibilidade: {compatibility}', { compatibility: percent(stats.compatibility) })}>
          <span>{percent(stats.compatibility)}</span>
        </div>
        <div className="dpoll__topinfo">
          <strong>{stats.level === 'GRAY' ? LEVEL_LABEL.GRAY : t('Compatibilidade {toLowerCase}', { toLowerCase: LEVEL_LABEL[stats.level].toLowerCase() })}</strong>
          <p className="muted">
            {percent(stats.coverage)} votaram
            <br />
            {stats.unanswered} sem resposta
          </p>
        </div>
      </div>
      <dl className="dpoll__counts">
        <div className="dpoll__count dpoll__count--YES">
          <dt>{t('Posso')}</dt>
          <dd>{stats.yes}</dd>
        </div>
        <div className="dpoll__count dpoll__count--MAYBE">
          <dt>{t('Talvez')}</dt>
          <dd>{stats.maybe}</dd>
        </div>
        <div className="dpoll__count dpoll__count--NO">
          <dt>{t('Não posso')}</dt>
          <dd>{stats.no}</dd>
        </div>
      </dl>
      {stats.lowCoverage ? <p className="muted dpoll__note">{t('Poucas pessoas responderam esta data. Ainda não dá para tratar como consenso.')}</p> : null}
    </section>
  );
}

function ProposalCard({ poll, busy, act }: { poll: PollView; busy: boolean; act: (work: () => Promise<PollView>) => Promise<void> }) {
  const p = poll.proposal!;
  const mine = p.myConfirmation;
  const step = confirmStepText(poll);
  const answer = (status: ConfirmationAnswer) => void act(() => api.respondPoll(poll.id, status));
  const time = new Date(p.startsAt).toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit', timeZone: poll.timezone });
  return (
    <section className="callout dpoll__proposal" aria-labelledby="dpoll-proposal-title">
      <p className="dpoll__proposal-kicker">{mine === null ? t('Sua vez: confirme a data') : t('Data proposta')}</p>
      <h2 id="dpoll-proposal-title" className="dpoll__proposal-day">
        {longDay(p.date)} · {time}
      </h2>
      {step ? <p className="dpoll__proposal-todo">{step.todo}</p> : null}
      <div className="row-actions" role="group" aria-label={t('Sua resposta para a data proposta')}>
        <Button small variant={mine === 'CONFIRMED' ? 'primary' : 'secondary'} disabled={busy} aria-pressed={mine === 'CONFIRMED'} onClick={() => answer('CONFIRMED')}>
          {mine === 'CONFIRMED' ? `✓ ${t('Vou')}` : t('Confirmar presença')}
        </Button>
        <Button small variant={mine === 'ADJUST' ? 'primary' : 'secondary'} disabled={busy} aria-pressed={mine === 'ADJUST'} onClick={() => answer('ADJUST')}>
          {mine === 'ADJUST' ? `✓ ${t('Preciso ajustar')}` : t('Preciso ajustar')}
        </Button>
        <Button small variant={mine === 'DECLINED' ? 'danger' : 'secondary'} disabled={busy} aria-pressed={mine === 'DECLINED'} onClick={() => answer('DECLINED')}>
          {mine === 'DECLINED' ? `✓ ${t('Não posso')}` : t('Não posso')}
        </Button>
      </div>
      <p className="muted">
        {t('{confirmed} vão · {adjust} precisam ajustar · {declined} não podem · {pending} sem resposta', { confirmed: p.tally.confirmed, adjust: p.tally.adjust, declined: p.tally.declined, pending: p.tally.pending })}
        {' · '}
        {t('{compat} de compatibilidade', { compat: percent(p.compatibility) })}
      </p>
      {step ? <p className="dpoll__proposal-next">{step.next}</p> : null}
      {poll.isOrganizer ? (
        <div className="dpoll__proposal-org">
          <p className="dpoll__proposal-kicker">{t('Você organiza')}</p>
          <div className="row-actions">
            {poll.confirmationPolicy === 'MANUAL' ? (
              <Button small disabled={busy} onClick={() => act(() => api.finalizePoll(poll.id))}>
                {t('Fechar a data')}
              </Button>
            ) : null}
            <Button small variant="quiet" disabled={busy} onClick={() => act(() => api.withdrawPoll(poll.id))}>
              {t('Escolher outra data')}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

const STEPS: { status: PollView['status']; label: string }[] = [
  { status: 'VOTING', label: 'Votação' },
  { status: 'CONFIRMING', label: 'Confirmar a data' },
  { status: 'FINALIZED', label: 'Data marcada' },
];

/** Em que etapa a votação está: votar nos dias → confirmar a data proposta → data marcada. */
function PollSteps({ status }: { status: PollView['status'] }) {
  const current = STEPS.findIndex((s) => s.status === status);
  return (
    <ol className="dpsteps" aria-label={t('Etapas da votação')}>
      {STEPS.map((s, i) => (
        <li key={s.status} className={`dpsteps__item${i < current ? ' is-done' : i === current ? ' is-current' : ''}`} aria-current={i === current ? 'step' : undefined}>
          <span className="dpsteps__dot" aria-hidden="true">{i < current ? '✓' : i + 1}</span>
          <span className="dpsteps__label">{t(s.label)}</span>
        </li>
      ))}
    </ol>
  );
}

/** Quem organiza muda nome, datas e quem escolhe o dia enquanto a votação está aberta. */
function EditPollSheet({ poll, onClose, onSaved }: { poll: PollView; onClose: () => void; onSaved: (p: PollView) => void }) {
  const [title, setTitle] = useState(poll.title);
  const [start, setStart] = useState(poll.rangeStart);
  const [end, setEnd] = useState(poll.rangeEnd);
  const [policy, setPolicy] = useState<'MAJORITY' | 'UNANIMITY' | 'MANUAL'>(poll.confirmationPolicy);
  const [calendar, setCalendar] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();
  const today = dayInZone(new Date().toISOString());
  const min = poll.rangeStart < today ? poll.rangeStart : today;
  const changed = title.trim() !== poll.title || start !== poll.rangeStart || end !== poll.rangeEnd || policy !== poll.confirmationPolicy;
  // Votando só o horário, o período é um dia só.
  const singleDay = poll.mode === 'BEST_TIME';

  async function save() {
    setBusy(true);
    setProblem(undefined);
    try {
      onSaved(await api.updatePoll(poll.id, { title: title.trim(), rangeStart: start, rangeEnd: end, confirmationPolicy: policy }));
    } catch (error) {
      setProblem(toApiError(error).message);
      setBusy(false);
    }
  }

  return (
    <Sheet title={calendar ? (singleDay ? t('Dia') : t('Período de datas')) : t('Editar votação')} onClose={calendar ? () => setCalendar(false) : onClose}>
      {calendar ? (
        <RangeCalendar
          start={start}
          end={end}
          min={min}
          single={singleDay}
          onPick={(a, b) => {
            setStart(a);
            setEnd(b);
            setCalendar(false);
          }}
        />
      ) : (
        <div className="pollcard__body">
          {problem ? <Notice tone="error">{problem}</Notice> : null}
          <Field label={t('Nome do encontro')} value={title} onChange={setTitle} maxLength={120} autoComplete="off" />
          <p className="pollcard__label">{singleDay ? t('Dia') : t('Período de datas')}</p>
          <button type="button" className="pollrange" onClick={() => setCalendar(true)} aria-label={singleDay ? t('Dia: {day}. Alterar', { day: longDay(start) }) : t('Período: {from} a {to}. Alterar', { from: longDay(start), to: longDay(end) })}>
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
          </button>
          <p className="pollcard__label">{t('Como escolher a data?')}</p>
          <div className="pollpolicy" role="group" aria-label={t('Como escolher a data')}>
            <button type="button" className="pollpolicy__opt" aria-pressed={policy !== 'MANUAL'} onClick={() => setPolicy('MAJORITY')}>
              {t('Maioria')}
            </button>
            <button type="button" className="pollpolicy__opt" aria-pressed={policy === 'MANUAL'} onClick={() => setPolicy('MANUAL')}>
              {t('Eu decido')}
            </button>
          </div>
          <p className="pollcard__hint pollcard__hint--wide">{POLICY_TEXT[policy]}</p>
          <Button onClick={save} full loading={busy} disabled={!changed || title.trim() === ''}>
            {t('Salvar')}
          </Button>
        </div>
      )}
    </Sheet>
  );
}
