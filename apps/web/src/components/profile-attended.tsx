import { useEffect, useState } from 'react';
import { Button, EmptyState, ErrorState, Loading, Notice } from './ui.tsx';
import { api } from '../client.ts';
import { formatWhen } from '../lib/chat.ts';
import { toApiError } from '../lib/errors.ts';
import type { ApiError } from '../lib/errors.ts';
import { kindLabel, safeImage } from '../lib/explore.ts';
import type { AttendedEvent, AttendedEventsPage } from '../lib/types.ts';
import { Link } from '../router.tsx';
import { t } from '../lib/i18n/index.ts';

const PAGE = 12;

function Tile({ event }: { event: AttendedEvent }) {
  const [failed, setFailed] = useState(false);
  const image = failed ? null : safeImage(event.imageUrl);
  return (
    <li className="ptile">
      <Link to={`/eventos/${encodeURIComponent(event.id)}`} className={`ptile__link evcover--${event.kind.toLowerCase()}${image ? '' : ' ptile__link--plain'}`}>
        {image ? <img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <span className="ptile__kind" aria-hidden="true">{kindLabel(event.kind)}</span>}
        <span className="ptile__info">
          <span className="ptile__title">{event.title}</span>
          <span className="ptile__when">{formatWhen(event.startsAt, event.endsAt, new Date())}</span>
          {event.private ? <span className="tag">{t('Privado')}</span> : null}
        </span>
      </Link>
    </li>
  );
}

/** Chave da aba "Participou": pública (visitantes veem) ou privada (só a dona). */
export function AttendedVisibilitySetting({ value, onChange }: { value: boolean; onChange: (next: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function toggle() {
    setBusy(true);
    setError(undefined);
    try {
      const result = await api.setAttendedVisibility(!value);
      onChange(result.attendedEventsPublic);
    } catch (failure) {
      setError(toApiError(failure).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <section className="setting">
        <div className="setting__text">
          <h2 className="setting__title" id="participou-titulo">
            {t('Mostrar eventos que participei')}
          </h2>
          <p className="setting__help">
            {value
              ? t('Visitantes veem a aba Participou. Eventos privados só aparecem para quem tem acesso a eles.')
              : t('Só você vê a aba Participou. Ligue para mostrar aos visitantes do seu perfil.')}
          </p>
        </div>
        <button type="button" role="switch" aria-checked={value} aria-labelledby="participou-titulo" className="switch" onClick={() => void toggle()} disabled={busy}>
          <span className="switch__thumb" />
        </button>
      </section>
    </>
  );
}

/** Aba "Participou": eventos que já acabaram em que a pessoa confirmou presença ou que ela criou. */
export function AttendedEvents({ username, mine, isPublic, onVisibilityChange }: { username: string; mine: boolean; isPublic: boolean; onVisibilityChange?: (next: boolean) => void }) {
  const [page, setPage] = useState<AttendedEventsPage | undefined>();
  const [error, setError] = useState<ApiError | undefined>();
  const [loading, setLoading] = useState(false);

  async function load(offset: number) {
    setLoading(true);
    setError(undefined);
    try {
      const next = await api.attendedEvents(username, { limit: PAGE, offset });
      setPage((current) => (offset === 0 || !current ? next : { ...next, items: [...current.items, ...next.items] }));
    } catch (failure) {
      setError(toApiError(failure));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setPage(undefined);
    void load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username]);

  const setting = mine && onVisibilityChange ? <AttendedVisibilitySetting value={isPublic} onChange={onVisibilityChange} /> : null;

  if (error && !page) {
    if (error.code === 'FORBIDDEN') return <EmptyState title={t('Eventos privados')}>{t('Esta pessoa escolheu não mostrar os eventos que participou.')}</EmptyState>;
    return <ErrorState message={error.message} onRetry={() => void load(0)} />;
  }
  if (!page) return <Loading />;
  if (page.items.length === 0) {
    return (
      <>
        {setting}
        {mine ? (
          <EmptyState title={t('Nenhum evento ainda')}>{t('Quando você confirmar presença com Eu vou e o evento acabar, ele aparece aqui.')}</EmptyState>
        ) : (
          <EmptyState title={t('Nenhum evento para mostrar')}>{t('Os eventos que essa pessoa participou aparecem aqui.')}</EmptyState>
        )}
      </>
    );
  }

  const tiles = page.items.map((event) => <Tile key={event.id} event={event} />);
  const left = tiles.filter((_, i) => i % 2 === 0);
  const right = tiles.filter((_, i) => i % 2 === 1);
  return (
    <>
      {setting}
      {error ? <ErrorState message={error.message} onRetry={() => void load(page.items.length)} /> : null}
      <div className="pgrid" aria-label={t('Eventos que participou')}>
        {[left, right].map((column, index) => (
          <ul className="pgrid__col" key={index}>
            {column}
          </ul>
        ))}
      </div>
      {page.items.length < page.total ? (
        <div className="more">
          <Button variant="secondary" loading={loading} onClick={() => void load(page.items.length)}>
            {t('Carregar mais')}
          </Button>
        </div>
      ) : null}
    </>
  );
}
