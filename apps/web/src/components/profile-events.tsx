import { useEffect, useState } from 'react';
import { Button, EmptyState, ErrorState, Loading } from './ui.tsx';
import { api } from '../client.ts';
import { formatWhen } from '../lib/chat.ts';
import { toApiError } from '../lib/errors.ts';
import type { ApiError } from '../lib/errors.ts';
import { kindLabel, safeImage } from '../lib/explore.ts';
import type { AttendedEvent, PostedEvent, PostedEventsPage, PostView } from '../lib/types.ts';
import { GoingTile } from './profile-attended.tsx';
import { Link } from '../router.tsx';
import { t } from '../lib/i18n/index.ts';

const PAGE = 12;
/** Presenças mostradas no perfil que a grade traz de uma vez. */
const GOING_MAX = 60;

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
          {event.sample ? <span className="tag tag--sample">{t('Exemplo de teste')}</span> : null}
        </span>
      </Link>
      {mine ? (
        <button type="button" className="ptile__remove" onClick={onRemove} disabled={busy} aria-label={t('Tirar {title} do perfil', { title: event.title })}>
          {t('Tirar do perfil')}
        </button>
      ) : null}
    </li>
  );
}

/** Evento que a pessoa publicou como post: mesmo desenho do evento postado, com a foto do post de capa. */
function PostTile({ post, mine, onRemove, busy }: { post: PostView; mine: boolean; onRemove: () => void; busy: boolean }) {
  const [failed, setFailed] = useState(false);
  const first = post.images[0];
  const image = first?.path && !failed ? api.assetUrl(first.path) : null;
  const event = post.event;
  if (!event) return null;
  return (
    <li className="ptile">
      <Link to={`/eventos/${encodeURIComponent(post.id)}`} className={`ptile__link evcover--other${image ? '' : ' ptile__link--plain'}`}>
        {image ? <img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <span className="ptile__kind" aria-hidden="true">{t('Evento')}</span>}
        <span className="ptile__info">
          <span className="ptile__title">{event.title}</span>
          <span className="ptile__when">{formatWhen(event.startsAt, event.endsAt, new Date())}</span>
        </span>
      </Link>
      {mine ? (
        <button type="button" className="ptile__remove" onClick={onRemove} disabled={busy} aria-label={t('Apagar o evento {title}', { title: event.title })}>
          {t('Apagar evento')}
        </button>
      ) : null}
    </li>
  );
}

/** Grade de duas colunas com os eventos que a pessoa postou. */
export function PostedEvents({ username, mine, onCount, quietEmpty }: { username: string; mine: boolean; onCount?: (total: number) => void; quietEmpty?: boolean }) {
  const [page, setPage] = useState<PostedEventsPage | undefined>();
  const [error, setError] = useState<ApiError | undefined>();
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | undefined>();
  const [eventPosts, setEventPosts] = useState<PostView[]>([]);
  const [going, setGoing] = useState<AttendedEvent[]>([]);

  async function load(offset: number) {
    setLoading(true);
    setError(undefined);
    try {
      const next = await api.profileEvents(username, { limit: PAGE, offset });
      let mine = eventPosts;
      let shown = going;
      if (offset === 0) {
        [mine, shown] = await Promise.all([
          api.userPosts(username, { limit: 30, offset: 0 }, 'event').then((p) => p.items),
          // Eventos em que a pessoa disse "Eu vou" e escolheu mostrar no perfil.
          api.shownGoingEvents(username, { limit: GOING_MAX, offset: 0 }).then((p) => p.items),
        ]);
        setEventPosts(mine);
        setGoing(shown);
      }
      setPage((current) => (offset === 0 || !current ? next : { ...next, items: [...current.items, ...next.items] }));
      onCount?.(next.total + mine.length + shown.length);
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
      onCount?.((page?.total ?? 1) - 1 + eventPosts.length + going.length);
    } catch (failure) {
      setError(toApiError(failure));
    } finally {
      setBusyId(undefined);
    }
  }

  async function removePost(post: PostView) {
    setBusyId(post.id);
    try {
      await api.deletePost(post.id);
      const rest = eventPosts.filter((x) => x.id !== post.id);
      setEventPosts(rest);
      onCount?.((page?.total ?? 0) + rest.length + going.length);
    } catch (failure) {
      setError(toApiError(failure));
    } finally {
      setBusyId(undefined);
    }
  }

  async function hideGoing(event: AttendedEvent) {
    setBusyId(event.id);
    try {
      await api.setGoingOnProfile(event.id, false);
      const rest = going.filter((x) => x.id !== event.id);
      setGoing(rest);
      onCount?.((page?.total ?? 0) + eventPosts.length + rest.length);
    } catch (failure) {
      setError(toApiError(failure));
    } finally {
      setBusyId(undefined);
    }
  }

  if (error && !page) return <ErrorState message={error.message} onRetry={() => void load(0)} />;
  if (!page) return <Loading />;
  if (page.items.length === 0 && eventPosts.length === 0 && going.length === 0) {
    if (quietEmpty) return null;
    return mine ? (
      <EmptyState
        title={t('Você ainda não postou eventos')}
        action={
          <Link to="/explorar" className="btn btn--primary">
            {t('Explorar eventos')}
          </Link>
        }
      >
        {t('Abra um evento e use Compartilhar para postar no seu perfil.')}
      </EmptyState>
    ) : (
      <EmptyState title={t('Nenhum evento postado')}>{t('Quando essa pessoa postar um evento, ele aparece aqui.')}</EmptyState>
    );
  }

  // Os eventos publicados como post vêm primeiro (mais novos), depois os eventos postados do Explorar.
  const tiles = [
    ...eventPosts.map((post) => <PostTile key={`p-${post.id}`} post={post} mine={mine} busy={busyId === post.id} onRemove={() => void removePost(post)} />),
    ...page.items.map((event) => <Tile key={event.id} event={event} mine={mine} busy={busyId === event.id} onRemove={() => void remove(event)} />),
    // Presenças mostradas no perfil, sem repetir o que já está postado. Tirar daqui leva o evento para a aba Participou.
    ...going
      .filter((event) => !page.items.some((x) => x.id === event.id))
      .map((event) => (
        <GoingTile
          key={`g-${event.id}`}
          event={event}
          action={mine ? { label: t('Tirar do perfil'), aria: t('Tirar {title} do perfil', { title: event.title }), busy: busyId === event.id, run: () => void hideGoing(event) } : undefined}
        />
      )),
  ];
  const left = tiles.filter((_, i) => i % 2 === 0);
  const right = tiles.filter((_, i) => i % 2 === 1);
  return (
    <>
      {error ? <ErrorState message={error.message} onRetry={() => void load(page.items.length)} /> : null}
      <div className="pgrid" aria-label={t('Eventos')}>
        {[left, right].map((column, index) => (
          <ul className="pgrid__col" key={index}>
            {column}
          </ul>
        ))}
      </div>
      {page.items.length < page.total ? (
        <div className="more">
          <Button variant="secondary" loading={loading} onClick={() => load(page.items.length)}>
            {t('Carregar mais')}
          </Button>
        </div>
      ) : null}
    </>
  );
}
