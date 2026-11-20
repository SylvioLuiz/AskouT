import { useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../client.ts';
import { toApiError } from '../lib/errors.ts';
import { confirmedLabel, dateTile } from '../lib/poster.ts';
import { Link } from '../router.tsx';
import { GoingChoiceSheet } from './going-choice.tsx';
import { t } from '../lib/i18n/index.ts';
import { useIsVisitor } from '../auth.tsx';
import { askLogin } from './visitor.tsx';

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
  endsAt,
  whenText,
  venue,
  image,
  fallback,
  count,
  tags,
  className,
  hideGoing = false,
}: {
  eventId: string;
  title: string;
  startsAt: string;
  /** Fim do evento: depois dele não há mais "Eu vou". Sem fim, vale o começo. */
  endsAt?: string;
  whenText: string;
  venue: ReactNode;
  image: string | null;
  fallback?: ReactNode;
  count?: number;
  tags?: ReactNode;
  className?: string;
  /** Quem criou o evento já participa dele: sem o botão "Eu vou". */
  hideGoing?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const [going, setGoing] = useState(false);
  const [confirmed, setConfirmed] = useState<number | undefined>(count);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();

  const [choosing, setChoosing] = useState(false);

  const visitor = useIsVisitor();

  async function toggle(onProfile?: boolean) {
    if (busy) return;
    // Sem conta: o "Eu vou" pede para entrar, como o resto do modo visitante.
    if (visitor) {
      askLogin(t('Entre para dizer "Eu vou" e receber um lembrete antes de começar.'));
      return;
    }
    // Confirmar pergunta antes se o evento aparece na aba Eventos do perfil.
    if (!going && onProfile === undefined) {
      setChoosing(true);
      return;
    }
    setBusy(true);
    setProblem(undefined);
    try {
      const page = going ? await api.eventCancel(eventId) : await api.eventGo(eventId, onProfile);
      setGoing(page.going);
      setConfirmed(page.confirmedCount);
    } catch (failure) {
      setProblem(toApiError(failure).message);
    } finally {
      setBusy(false);
      setChoosing(false);
    }
  }

  const over = Date.parse(endsAt ?? startsAt) <= Date.now();
  const label = confirmedLabel(confirmed);
  return (
    <article className={`poster poster--event${className ? ` ${className}` : ''}`}>
      <div className="poster__bg" aria-hidden="true">
        {image && !failed ? <img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : fallback}
      </div>
      <div className="poster__scrim" aria-hidden="true" />
      {/* O cartaz inteiro abre o evento; o título continua sendo o link para teclado e leitor de tela. */}
      <Link to={`/eventos/${encodeURIComponent(eventId)}`} className="poster__hit" tabIndex={-1} aria-hidden="true">{null}</Link>
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
          {over || hideGoing ? null : (
            <button type="button" className="poster__cta" onClick={() => void toggle()} aria-pressed={going} disabled={busy}>
              {going ? t('Confirmado') : t('Eu vou')}
            </button>
          )}
        </div>
      </div>
      {choosing ? <GoingChoiceSheet event={{ id: eventId, startsAt, endsAt }} busy={busy} onChoose={(onProfile) => void toggle(onProfile)} onClose={() => setChoosing(false)} /> : null}
    </article>
  );
}
