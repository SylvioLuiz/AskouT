import { useEffect, useState } from 'react';
import { Button, EmptyState, ErrorState, Loading } from './ui.tsx';
import { api } from '../client.ts';
import { formatWhen } from '../lib/chat.ts';
import { toApiError } from '../lib/errors.ts';
import type { ApiError } from '../lib/errors.ts';
import { kindLabel, safeImage } from '../lib/explore.ts';
import type { AttendedEvent, AttendedEventsPage } from '../lib/types.ts';
import { Link } from '../router.tsx';
import { InfoIcon } from './icons.tsx';
import { TileMenu, useTileMenu } from './tile-press.tsx';
import { t } from '../lib/i18n/index.ts';

const PAGE = 12;

/** Cartão de um evento em que a pessoa confirmou presença. `action` é a opção da dona (tirar ou mostrar no perfil), que aparece ao segurar o cartão. */
export function GoingTile({ event, action }: { event: AttendedEvent; action?: { label: string; aria: string; busy: boolean; run: () => void } }) {
  const [failed, setFailed] = useState(false);
  const image = failed ? null : safeImage(event.imageUrl);
  const menu = useTileMenu(action !== undefined);
  return (
    <li className={`ptile${action ? ' ptile--press' : ''}`}>
      <Link {...menu.press} to={`/eventos/${encodeURIComponent(event.id)}`} className={`ptile__link evcover--${event.kind.toLowerCase()}${image ? '' : ' ptile__link--plain'}`}>
        {image ? <img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <span className="ptile__kind" aria-hidden="true">{kindLabel(event.kind)}</span>}
        <span className="ptile__info">
          <span className="ptile__title">{event.title}</span>
          <span className="ptile__when">{formatWhen(event.startsAt, event.endsAt, new Date())}</span>
          {event.private ? <span className="tag">{t('Privado')}</span> : null}
        </span>
      </Link>
      {action ? (
        // Teclado e leitor de tela: o mesmo menu de segurar o cartão.
        <button type="button" className="visually-hidden" onClick={() => menu.setOpen(true)}>
          {t('Opções de {title}', { title: event.title })}
        </button>
      ) : null}
      {action && menu.open ? <TileMenu title={event.title} actions={[{ label: action.label, busy: action.busy, run: action.run }]} onClose={() => menu.setOpen(false)} /> : null}
    </li>
  );
}

/** Aba "Participou" (só a dona do perfil vê): eventos em que ela disse "Eu vou" e escolheu não mostrar na aba Eventos. */
export function AttendedEvents({ username }: { username: string }) {
  const [page, setPage] = useState<AttendedEventsPage | undefined>();
  const [error, setError] = useState<ApiError | undefined>();
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | undefined>();
  const [infoOpen, setInfoOpen] = useState(false);

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

  async function show(event: AttendedEvent) {
    setBusyId(event.id);
    try {
      await api.setGoingOnProfile(event.id, true);
      setPage((current) => (current ? { ...current, total: current.total - 1, items: current.items.filter((x) => x.id !== event.id) } : current));
    } catch (failure) {
      setError(toApiError(failure));
    } finally {
      setBusyId(undefined);
    }
  }

  if (error && !page) return <ErrorState message={error.message} onRetry={() => void load(0)} />;
  if (!page) return <Loading />;
  // A explicação fica atrás de um ícone de informação, aberta só quando a pessoa toca nele.
  const intro = (
    <div className="attinfo">
      <button type="button" className="attinfo__btn" onClick={() => setInfoOpen((v) => !v)} aria-expanded={infoOpen} aria-controls="attinfo-texto" aria-label={t('Sobre esta aba')}>
        <InfoIcon />
      </button>
      {infoOpen ? (
        <p className="attinfo__text" id="attinfo-texto" role="note">
          {t('Só você vê esta aba. Aqui ficam os eventos em que você disse Eu vou sem mostrar no perfil.')}{' '}
          {t('Segure um evento para tirar ou mostrar no perfil.')}
        </p>
      ) : null}
    </div>
  );
  if (page.items.length === 0) {
    return (
      <>
        {intro}
        <EmptyState title={t('Nenhum evento aqui')}>{t('Ao tocar em Eu vou, escolha Só para mim para o evento ficar nesta aba.')}</EmptyState>
      </>
    );
  }

  const tiles = page.items.map((event) => (
    <GoingTile key={event.id} event={event} action={{ label: t('Mostrar no perfil'), aria: t('Mostrar {title} no perfil', { title: event.title }), busy: busyId === event.id, run: () => void show(event) }} />
  ));
  const left = tiles.filter((_, i) => i % 2 === 0);
  const right = tiles.filter((_, i) => i % 2 === 1);
  return (
    <>
      {intro}
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
          <Button variant="secondary" loading={loading} onClick={() => load(page.items.length)}>
            {t('Carregar mais')}
          </Button>
        </div>
      ) : null}
    </>
  );
}
