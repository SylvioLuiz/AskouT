import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Avatar, Button, Confirm, ErrorState, Loading, Notice, PageHead } from '../components/ui.tsx';
import { api } from '../client.ts';
import { useAsync, usePolling, useTitle } from '../hooks.ts';
import { LEVEL_LABEL, POLICY_LABEL, VOTE_LABEL, VOTE_MARK, calendarWeeks, cellLabel, longDay, monthTitle, percent, podiumDay, shortDay } from '../lib/date-poll.ts';
import type { ConfirmationAnswer, DateStats, PollView, VoteStatus } from '../lib/date-poll.ts';
import { toApiError } from '../lib/errors.ts';
import { isoToLocalInput } from '../lib/post-draft.ts';
import { Link, navigate } from '../router.tsx';

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
  useTitle(poll?.title ?? 'Encontrar a melhor data');

  if (!poll) {
    if (load.error) return <ErrorState message={load.error.message} onRetry={load.reload} />;
    return <Loading />;
  }
  return <PollBody poll={poll} setPoll={setPoll} />;
}

function PollBody({ poll, setPoll }: { poll: PollView; setPoll: (p: PollView) => void }) {
  const [tab, setTab] = useState<Tab>(poll.status === 'VOTING' ? 'mine' : 'group');
  const [brush, setBrush] = useState<Brush>('YES');
  const [selected, setSelected] = useState<string | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<'cancel' | undefined>();
  const [showAll, setShowAll] = useState(false);
  // Os toques viram pedidos em fila, para a resposta mais velha não apagar a mais nova.
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const canVote = poll.votingOpen;
  const byDate = new Map(poll.days.map((d) => [d.date, d] as const));

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

  function tapDay(date: string) {
    setSelected(date);
    if (tab === 'mine' && canVote) paint([date]);
  }

  const selectedStats = selected ? byDate.get(selected) : undefined;
    const finished = poll.participants.filter((p) => p.finished).length;
  const weeks = calendarWeeks(poll.rangeStart, poll.rangeEnd);
  const allDays = poll.days.map((d) => d.date);

  return (
    <div className="dpoll">
      <PageHead title={poll.title} back={`/conversas/${poll.conversationId}`} subtitle={`${shortDay(poll.rangeStart)} a ${shortDay(poll.rangeEnd)}`} />
      {problem ? <Notice tone="error">{problem}</Notice> : null}

      {poll.status === 'FINALIZED' && poll.final ? (
        <section className="callout dpoll__final" aria-label="Data definida">
          <p className="callout__text">
            <strong>Data definida: {longDay(poll.final.date)}</strong>
            <br />
            {new Date(poll.final.startsAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: poll.timezone })} às {new Date(poll.final.endsAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: poll.timezone })}
          </p>
          <div className="row-actions">
            {poll.final.meetupId ? (
              <Link to="/agenda" className="btn btn--secondary btn--small">
                Ver na agenda
              </Link>
            ) : null}
            <Link to={`/conversas/${poll.conversationId}`} className="btn btn--secondary btn--small">
              Voltar à conversa
            </Link>
            {poll.isOrganizer ? (
              <Link to={`/criar?${new URLSearchParams({ votacao: poll.id, titulo: poll.title, inicio: isoToLocalInput(poll.final.startsAt), fim: isoToLocalInput(poll.final.endsAt), conversa: poll.conversationId }).toString()}`} className="btn btn--primary btn--small">
                Transformar em evento
              </Link>
            ) : null}
          </div>
        </section>
      ) : null}
      {poll.status === 'VOTING' && poll.votingClosed ? <Notice>Os votos foram encerrados. {poll.isOrganizer ? 'Escolha a data entre as melhores abaixo.' : 'Aguarde quem organiza escolher a data.'}</Notice> : null}
      {poll.canClose ? (
        <div className="callout">
          <p className="callout__text">
            <strong>Todos já votaram.</strong> Você pode encerrar a votação agora e escolher a data.
          </p>
          <Button small loading={busy} onClick={() => void act(() => api.closePoll(poll.id))}>
            Encerrar votação
          </Button>
        </div>
      ) : null}
      {poll.status === 'CANCELLED' ? <Notice>Esta votação foi cancelada.</Notice> : null}

      {poll.proposal && poll.status === 'CONFIRMING' ? <ProposalCard poll={poll} busy={busy} act={act} /> : null}

      <p className="dpoll__meta muted">
        {POLICY_LABEL[poll.confirmationPolicy]}
        {poll.votingClosed ? ' · votos encerrados' : poll.votingDeadline ? ` · votação até ${new Date(poll.votingDeadline).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}
        {' · '}
        {finished} de {poll.participants.length} concluíram
      </p>

      <div className="segtabs" role="tablist" aria-label="Visão do calendário">
        <button type="button" role="tab" aria-selected={tab === 'mine'} className="segtabs__tab" onClick={() => setTab('mine')}>
          Meu voto
        </button>
        <button type="button" role="tab" aria-selected={tab === 'group'} className="segtabs__tab" onClick={() => setTab('group')}>
          Mapa do grupo
        </button>
      </div>

      {tab === 'mine' && canVote ? (
        <div className="dpoll__brushes" role="group" aria-label="Escolha uma resposta e toque nos dias">
          {BRUSHES.map((b) => (
            <button key={b} type="button" className={`dpoll__brush dpoll__brush--${b}`} aria-pressed={brush === b} onClick={() => setBrush(b)}>
              <span aria-hidden="true">{VOTE_MARK[b]}</span> {VOTE_LABEL[b]}
            </button>
          ))}
          <button type="button" className="dpoll__brush dpoll__brush--CLEAR" aria-pressed={brush === 'CLEAR'} onClick={() => setBrush('CLEAR')}>
            Limpar
          </button>
        </div>
      ) : null}
      {tab === 'mine' && canVote ? (
        <div className="row-actions">
          <Button small variant="quiet" onClick={() => paint(allDays)}>
            Aplicar a todos os dias
          </Button>
        </div>
      ) : null}
      {tab === 'mine' && !canVote && poll.status === 'VOTING' ? <Notice>O prazo da votação acabou.</Notice> : null}

      <div className="dpcal" role="grid" aria-label={`Calendário de ${monthTitle(poll.rangeStart)}`}>
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
              const cls =
                tab === 'mine'
                  ? `dpcal__cell dpcal__cell--${mine ?? 'NONE'}`
                  : `dpcal__cell dpcal__cell--L${stats.level}`;
              return (
                <button key={di} type="button" role="gridcell" className={`${cls}${selected === date ? ' is-selected' : ''}`} aria-label={cellLabel(stats, mine)} aria-selected={selected === date} onClick={() => tapDay(date)}>
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
        <p className="dpoll__legend muted">Dia sem marca fica “sem resposta” e não conta como “não posso”.</p>
      )}

      {selectedStats ? <DayDetail stats={selectedStats} poll={poll} busy={busy} onPropose={() => void act(() => api.proposePoll(poll.id, selectedStats.date))} /> : null}

      {canVote ? (
        <div className="dpoll__finish">
          {poll.iFinished ? (
            <>
              <p className="dpoll__done">✓ Você concluiu sua votação. Pode mudar os votos até o encerramento.</p>
              <Button small variant="secondary" loading={busy} onClick={() => void act(() => api.finishPoll(poll.id, false))}>
                Reabrir minha votação
              </Button>
            </>
          ) : (
            <Button full loading={busy} onClick={() => void act(() => api.finishPoll(poll.id, true))}>
              Concluí minha votação
            </Button>
          )}
        </div>
      ) : null}

      <section aria-labelledby="dpoll-rank">
        <h2 id="dpoll-rank" className="dpoll__h">
          Melhores datas
        </h2>
        {!poll.enoughData ? (
          <p className="muted">Ainda faltam respostas para sugerir uma data. Peça para o pessoal votar.</p>
        ) : (
          <>
            <ol className="dpoll__podium" aria-label="Três melhores datas">
              {[1, 0, 2].map((i) => {
                const d = poll.ranking[i];
                if (!d) return <li key={i} className="dpoll__pcol dpoll__pcol--empty" aria-hidden="true" />;
                return (
                  <li key={d.date} className={`dpoll__pcol dpoll__pcol--${i + 1}`}>
                    <button type="button" className="dpoll__pbtn" onClick={() => { setSelected(d.date); setTab('group'); }} aria-label={`${i + 1}º lugar: ${longDay(d.date)}, ${percent(d.compatibility)} de compatibilidade`}>
                      {i === 0 ? <span className="dpoll__crown" aria-hidden="true">👑</span> : <span className="dpoll__ppos" aria-hidden="true">{i + 1}º</span>}
                      <span className="dpoll__pday">{podiumDay(d.date)}</span>
                      <span className="dpoll__ppct">{percent(d.compatibility)}{i === 0 ? ' compatível' : ''}</span>
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
                  {poll.ranking[0].yes} posso, {poll.ranking[0].maybe} talvez, {poll.ranking[0].no} não posso. Toque em uma data para ver quem pode.
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
                          {percent(d.compatibility)} de compatibilidade · {percent(d.coverage)} votaram · {d.yes} posso, {d.maybe} talvez, {d.no} não posso
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
                {showAll ? 'Ver só as 3 melhores' : 'Ver todas as datas'}
              </Button>
            ) : null}
          </>
        )}
      </section>

      <section aria-labelledby="dpoll-people">
        <h2 id="dpoll-people" className="dpoll__h">
          Quem vota
        </h2>
        <ul className="dpoll__people">
          {poll.participants.map((p) => (
            <li key={p.profile.userId}>
              <Avatar profile={p.profile} size={32} />
              <span>{p.profile.displayName}</span>
              <span className="muted">{p.finished ? 'concluiu' : 'ainda votando'}</span>
            </li>
          ))}
        </ul>
      </section>

      {poll.history.length > 0 ? (
        <section aria-labelledby="dpoll-hist">
          <h2 id="dpoll-hist" className="dpoll__h">
            Histórico
          </h2>
          <ul className="dpoll__hist">
            {poll.history.map((h) => (
              <li key={h.id}>
                {longDay(h.date)} — {h.status === 'CONFIRMED' ? 'confirmada' : h.status === 'REJECTED' ? 'não passou' : 'retirada'}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {poll.isOrganizer && (poll.status === 'VOTING' || poll.status === 'CONFIRMING') ? (
        confirming === 'cancel' ? (
          <Confirm danger question="Cancelar esta votação? Os votos ficam guardados, mas ninguém mais pode votar." confirmLabel="Cancelar votação" busy={busy} onCancel={() => setConfirming(undefined)} onConfirm={() => void act(async () => {
            const next = await api.cancelPoll(poll.id);
            navigate(`/conversas/${poll.conversationId}`);
            return next;
          }).then(() => setConfirming(undefined))} />
        ) : (
          <Button variant="quiet" onClick={() => setConfirming('cancel')}>
            Cancelar votação
          </Button>
        )
      ) : null}
    </div>
  );
}

function DayDetail({ stats, poll, busy, onPropose }: { stats: DateStats; poll: PollView; busy: boolean; onPropose: () => void }) {
  return (
    <section className="dpoll__detail" aria-label={`Detalhes de ${longDay(stats.date)}`}>
      <h2 className="dpoll__h">{longDay(stats.date)}</h2>
      <div className="dpoll__ring" style={{ '--v': Math.max(0, Math.min(100, stats.compatibility ?? 0)) } as CSSProperties} role="img" aria-label={stats.compatibility === null ? 'Compatibilidade: sem votos' : `Compatibilidade: ${percent(stats.compatibility)}`}>
        <span>
          {percent(stats.compatibility)}
          <small>compatível</small>
        </span>
      </div>
      <dl className="dpoll__counts">
        <div className="dpoll__count dpoll__count--YES">
          <dt>Posso</dt>
          <dd>{stats.yes}</dd>
        </div>
        <div className="dpoll__count dpoll__count--MAYBE">
          <dt>Talvez</dt>
          <dd>{stats.maybe}</dd>
        </div>
        <div className="dpoll__count dpoll__count--NO">
          <dt>Não posso</dt>
          <dd>{stats.no}</dd>
        </div>
      </dl>
      <p className="dpoll__foot">
        {percent(stats.coverage)} votaram · {stats.unanswered} sem resposta
      </p>
      <p className="muted dpoll__note">{stats.lowCoverage ? 'Poucas pessoas responderam esta data. Ainda não dá para tratar como consenso.' : `Nível: ${LEVEL_LABEL[stats.level]}`}</p>
      {poll.isOrganizer && poll.status === 'VOTING' ? (
        <Button full loading={busy} onClick={onPropose}>
          Propor esta data
        </Button>
      ) : null}
    </section>
  );
}

function ProposalCard({ poll, busy, act }: { poll: PollView; busy: boolean; act: (work: () => Promise<PollView>) => Promise<void> }) {
  const p = poll.proposal!;
  const mine = p.myConfirmation;
  const answer = (status: ConfirmationAnswer) => void act(() => api.respondPoll(poll.id, status));
  return (
    <section className="callout dpoll__proposal" aria-label="Data em confirmação">
      <p className="callout__text">
        <strong>Data proposta: {longDay(p.date)}</strong>
        <br />
        {new Date(p.startsAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: poll.timezone })} · {percent(p.compatibility)} de compatibilidade
      </p>
      <p className="muted">
        {p.tally.confirmed} confirmaram · {p.tally.adjust} precisam ajustar · {p.tally.declined} recusaram · {p.tally.pending} sem resposta
      </p>
      <div className="row-actions">
        <Button small variant={mine === 'CONFIRMED' ? 'primary' : 'secondary'} disabled={busy} onClick={() => answer('CONFIRMED')}>
          {mine === 'CONFIRMED' ? '✓ Confirmado' : 'Confirmar presença'}
        </Button>
        <Button small variant={mine === 'ADJUST' ? 'primary' : 'secondary'} disabled={busy} onClick={() => answer('ADJUST')}>
          Preciso ajustar
        </Button>
        <Button small variant={mine === 'DECLINED' ? 'danger' : 'secondary'} disabled={busy} onClick={() => answer('DECLINED')}>
          Recusar
        </Button>
      </div>
      {poll.isOrganizer ? (
        <div className="row-actions">
          {poll.confirmationPolicy === 'MANUAL' ? (
            <Button small disabled={busy} onClick={() => void act(() => api.finalizePoll(poll.id))}>
              Fechar a data
            </Button>
          ) : null}
          <Button small variant="quiet" disabled={busy} onClick={() => void act(() => api.withdrawPoll(poll.id))}>
            Escolher outra data
          </Button>
        </div>
      ) : null}
    </section>
  );
}
