import { Link } from '../router.tsx';
import { longDay, percent, shortDay } from '../lib/date-poll.ts';
import type { PollSummary } from '../lib/date-poll.ts';
import { intlLocale, t } from '../lib/i18n/index.ts';

function line(p: PollSummary): string {
  if (p.status === 'FINALIZED') return p.finalDate ? t('Data definida: {finalDate}', { finalDate: longDay(p.finalDate) }) : t('Data definida');
  if (p.status === 'CONFIRMING') return p.proposedDate ? t('Confirmando {proposedDate}', { proposedDate: longDay(p.proposedDate) }) : t('Data em confirmação');
  if (p.best) return t('Melhor até agora: {date} ({compatibility} de compatibilidade, {coverage} votaram)', { date: longDay(p.best.date), compatibility: percent(p.best.compatibility), coverage: percent(p.best.coverage) });
  return t('Faltam votos para sugerir uma data');
}

function todo(p: PollSummary): string | null {
  if (p.needsMyConfirmation) return t('Confirme a data proposta');
  if (p.needsMyVote) return t('Falta você votar');
  return null;
}

/** Resumo das votações de data do grupo: progresso, melhor data até agora e o que falta de você. */
export function GroupPolls({ items }: { items: PollSummary[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="grp-polls">
      <h2 id="grp-polls" className="dpoll__h">
        {t('Votações e eventos marcados')}
      </h2>
      <ul className="dpsum">
        {items.map((p) => {
          if (p.event) {
            const starts = new Date(p.event.startsAt);
            return (
              <li key={p.id}>
                <Link to={`/eventos/${encodeURIComponent(p.event.id)}`} className="dpsum__item">
                  <strong>{p.event.title}</strong>
                  <span>{starts.toLocaleString(intlLocale(), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                  <span className="muted">{t('Evento marcado pela votação')}</span>
                </Link>
              </li>
            );
          }
          const action = todo(p);
          return (
            <li key={p.id}>
              <Link to={`/planejar/${p.id}`} className={`dpsum__item${action ? ' is-todo' : ''}`}>
                <strong>{p.title}</strong>
                <span className="muted">
                  {shortDay(p.rangeStart)} a {shortDay(p.rangeEnd)}
                  {p.status === 'VOTING' ? t(' · {done} de {total} concluíram', { done: p.finishedCount, total: p.participantCount }) : ''}
                </span>
                <span>{line(p)}</span>
                {p.status === 'VOTING' && p.votingDeadline ? <span className="muted">{t('Votação até {when}', { when: new Date(p.votingDeadline).toLocaleString(intlLocale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) })}</span> : null}
                {action ? <span className="dpsum__todo">{action}</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
