import { useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../client.ts';
import { toApiError } from '../lib/errors.ts';
import { confirmedLabel, dateTile } from '../lib/poster.ts';
import { Link } from '../router.tsx';

/** Selo com o dia do evento ("SÁB 25 OUT"), em vidro sobre a foto. */
export function DateBadge({ startsAt, mini = false }: { startsAt: string; mini?: boolean }) {
  const tile = dateTile(startsAt);
  if (!tile) return null;
  return (
    <div className={`poster__date${mini ? ' poster__date--mini' : ''}`} aria-hidden="true">
      <span className="poster__date-w">{tile.weekday}</span>
      <span className="poster__date-d">{tile.day}</span>
      <span className="poster__date-m">{tile.month}</span>
    </div>
  );
}

/**
 * Evento em formato de cartaz: foto inteira, título grande, "Eu vou" e quantos confirmaram.
 * O cartão todo abre a página do evento; o botão e o link do local ficam por cima.
 */
export function PosterEvent({
  eventId,
  title,
  startsAt,
  whenText,
  venue,
  image,
  fallback,
  count,
  tags,
  className,
}: {
  eventId: string;
  title: string;
  startsAt: string;
  whenText: string;
  venue: ReactNode;
  image: string | null;
  fallback?: ReactNode;
  count?: number;
  tags?: ReactNode;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const [going, setGoing] = useState(false);
  const [confirmed, setConfirmed] = useState<number | undefined>(count);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();

  async function toggle() {
    if (busy) return;
    setBusy(true);
    setProblem(undefined);
    try {
      const page = going ? await api.eventCancel(eventId) : await api.eventGo(eventId);
      setGoing(page.going);
      setConfirmed(page.confirmedCount);
    } catch (failure) {
      setProblem(toApiError(failure).message);
    } finally {
      setBusy(false);
    }
  }

  const label = confirmedLabel(confirmed);
  return (
    <article className={`poster poster--event${className ? ` ${className}` : ''}`}>
      <div className="poster__bg" aria-hidden="true">
        {image && !failed ? <img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : fallback}
      </div>
      <div className="poster__scrim" aria-hidden="true" />
      <DateBadge startsAt={startsAt} />
      {tags ? <div className="poster__tags">{tags}</div> : null}
      <div className="poster__info">
        <div className="poster__meta">
          <span className="poster__venue">{venue}</span>
          <span> · {whenText}</span>
        </div>
        <h3 className="poster__title">
          <Link to={`/eventos/${encodeURIComponent(eventId)}`} className="poster__link">
            {title}
          </Link>
        </h3>
        {problem ? <p className="poster__problem" role="alert">{problem}</p> : null}
        <div className="poster__row">
          {label ? <span className="poster__glass">{label}</span> : <span />}
          <button type="button" className="poster__cta" onClick={() => void toggle()} aria-pressed={going} disabled={busy}>
            {going ? 'Confirmado' : 'Eu vou'}
          </button>
        </div>
      </div>
    </article>
  );
}
