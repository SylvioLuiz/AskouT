import { useEffect, useState } from 'react';
import { Button, EmptyState, ErrorState, Loading } from './ui.tsx';
import { api } from '../client.ts';
import { formatWhen } from '../lib/chat.ts';
import { toApiError } from '../lib/errors.ts';
import type { ApiError } from '../lib/errors.ts';
import { kindLabel, safeImage } from '../lib/explore.ts';
import type { PostedEvent, PostedEventsPage } from '../lib/types.ts';
import { Link } from '../router.tsx';

const PAGE = 12;

function Tile({ event, mine, onRemove, busy }: { event: PostedEvent; mine: boolean; onRemove: () => void; busy: boolean }) {
  const [failed, setFailed] = useState(false);
  const image = failed ? null : safeImage(event.imageUrl);
  return (
    <li className="ptile">
      <Link to={`/eventos/${encodeURIComponent(event.id)}`} className={`ptile__link evcover--${event.kind.toLowerCase()}${image ? '' : ' ptile__link--plain'}`}>
        {image ? <img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <span className="ptile__kind" aria-hidden="true">{kindLabel(event.kind)}</span>}
        <span className="ptile__info">
          <span className="ptile__title">{event.title}</span>
          <span className="ptile__when">{formatWhen(event.startsAt, event.endsAt, new Date())}</span>
          {event.sample ? <span className="tag tag--sample">Exemplo de teste</span> : null}
        </span>
      </Link>
      {mine ? (
        <button type="button" className="ptile__remove" onClick={onRemove} disabled={busy} aria-label={`Tirar ${event.title} do perfil`}>
          Tirar do perfil
        </button>
      ) : null}
    </li>
  );
}

/** Grade de duas colunas com os eventos que a pessoa postou. */
export function PostedEvents({ username, mine, onCount }: { username: string; mine: boolean; onCount?: (total: number) => void }) {
  const [page, setPage] = useState<PostedEventsPage | undefined>();
  const [error, setError] = useState<ApiError | undefined>();
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | undefined>();

  async function load(offset: number) {
    setLoading(true);
    setError(undefined);
    try {
      const next = await api.profileEvents(username, { limit: PAGE, offset });
      setPage((current) => (offset === 0 || !current ? next : { ...next, items: [...current.items, ...next.items] }));
      onCount?.(next.total);
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

  async function remove(event: PostedEvent) {
    setBusyId(event.id);
    try {
      await api.unpostEvent(event.id);
      setPage((current) => (current ? { ...current, total: current.total - 1, items: current.items.filter((x) => x.id !== event.id) } : current));
      onCount?.((page?.total ?? 1) - 1);
    } catch (failure) {
      setError(toApiError(failure));
    } finally {
      setBusyId(undefined);
    }
  }

  if (error && !page) return <ErrorState message={error.message} onRetry={() => void load(0)} />;
  if (!page) return <Loading />;
  if (page.items.length === 0) {
    return mine ? (
      <EmptyState
        title="Você ainda não postou eventos"
        action={
          <Link to="/explorar" className="btn btn--primary">
            Explorar eventos
          </Link>
        }
      >
        Abra um evento e use Compartilhar para postar no seu perfil.
      </EmptyState>
    ) : (
      <EmptyState title="Nenhum evento postado">Quando essa pessoa postar um evento, ele aparece aqui.</EmptyState>
    );
  }

  const left = page.items.filter((_, i) => i % 2 === 0);
  const right = page.items.filter((_, i) => i % 2 === 1);
  return (
    <>
      {error ? <ErrorState message={error.message} onRetry={() => void load(page.items.length)} /> : null}
      <div className="pgrid" aria-label="Eventos postados">
        {[left, right].map((column, index) => (
          <ul className="pgrid__col" key={index}>
            {column.map((event) => (
              <Tile key={event.id} event={event} mine={mine} busy={busyId === event.id} onRemove={() => void remove(event)} />
            ))}
          </ul>
        ))}
      </div>
      {page.items.length < page.total ? (
        <div className="more">
          <Button variant="secondary" loading={loading} onClick={() => void load(page.items.length)}>
            Carregar mais
          </Button>
        </div>
      ) : null}
    </>
  );
}
