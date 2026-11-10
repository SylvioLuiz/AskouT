import { OpenInMaps } from '../components/open-in-maps.tsx';
import { shareOrigin } from '../lib/public-origin.ts';
import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { CreateMeetupSheet } from '../components/meetup.tsx';
import { StoryCreateSheet, StoryViewer } from '../components/event-story.tsx';
import { Sheet } from '../components/agenda.tsx';
import { CalendarIcon, CalendarPlusIcon, ChevronLeftIcon, EventKindIcon, LocationIcon, MapIcon, MoreIcon, PlusIcon, RouteIcon, ShareIcon, TicketIcon, UserIcon } from '../components/icons.tsx';
import { ShareEventSheet } from '../components/share-event.tsx';
import { SampleBadge } from '../components/suggestions.tsx';
import { Avatar, Button, ErrorState, Field, Loading, Notice } from '../components/ui.tsx';
import { api } from '../client.ts';
import { useAsync, useTitle } from '../hooks.ts';
import { startOf } from '../lib/stories.ts';
import type { StoryPos } from '../lib/stories.ts';
import { eventLink } from '../lib/share.ts';
import { attendeeStrip, eventDateLabel, eventTimeLabel, venueLine } from '../lib/event-page.ts';
import { kindLabel, safeImage } from '../lib/explore.ts';
import { formatDistance } from '../lib/flash.ts';
import { ticketHost } from '../lib/venue.ts';
import { toApiError } from '../lib/errors.ts';
import { addToCalendar } from '../lib/ics.ts';
import { resizePostPhoto } from '../lib/image.ts';
import { MEETUP_ACTION_LABEL } from '../lib/meetup.ts';
import { timeAgo } from '../lib/format.ts';
import type { EventPage, FeedSettings } from '../lib/types.ts';
import { Feed } from '../components/feed.tsx';
import { policyNote } from '../lib/feed.ts';
import { Link, navigate, useSearch } from '../router.tsx';
import { useCurrentPosition } from './explore.tsx';
import { t } from '../lib/i18n/index.ts';
import { trackTicketClick } from '../components/sponsored-view.tsx';

/** O mesmo texto máximo que a API aceita num post de evento. */
const EVENT_POST_CAPTION_MAX = 500;
/** Avatares na fileira; o resto vira "+N". */
const STRIP_MAX = 7;

/** Capa: endereço https (evento do local) ou caminho da própria API (foto enviada / foto assinada do Google). */
function coverSrc(path: string | null): string | null {
  if (!path) return null;
  return path.startsWith('/') ? api.assetUrl(path) : safeImage(path);
}

/** Cria o arquivo de agenda do evento e abre na agenda (ou baixa, no navegador). */
async function addEventToCalendar(page: EventPage): Promise<void> {
  await addToCalendar({ id: page.id, title: page.title, description: page.description, startsAt: page.startsAt, endsAt: page.endsAt, venue: page.venue.name ? { name: page.venue.name, address: page.venue.address } : null, url: eventLink(shareOrigin(), page.id) });
}

function goBack() {
  if (window.history.length > 1) window.history.back();
  else navigate('/explorar');
}

/** Menu ⋯ do evento: compartilhar e adicionar à agenda. */
function EventMenuSheet({ page, onShare, onClose }: { page: EventPage; onShare: () => void; onClose: () => void }) {
  const [message, setMessage] = useState<string | undefined>();

  return (
    <Sheet title={t('Opções do evento')} onClose={onClose}>
      {message ? <Notice tone="error">{message}</Notice> : null}
      <div className="sheetactions">
      <Button full variant="secondary" onClick={onShare}>
        <ShareIcon /> {t('Compartilhar')}
      </Button>
      <Button
        full
        variant="secondary"
        onClick={() => {
          setMessage(undefined);
          addEventToCalendar(page).then(onClose, (failure: unknown) => setMessage(failure instanceof Error ? failure.message : t('Não foi possível adicionar à agenda.')));
        }}
      >
        <CalendarIcon /> {t('Adicionar à agenda')}
      </Button>
      </div>
    </Sheet>
  );
}

// ---------- Página ----------

export function EventScreen({ eventId }: { eventId: string }) {
  const where = useCurrentPosition();
  const waiting = where.status === 'asking';
  const loaded = useAsync<EventPage | null>(async () => (waiting ? null : api.eventPage(eventId, where.position)), [eventId, waiting, where.position?.lat, where.position?.lng]);
  const [fresh, setFresh] = useState<EventPage | undefined>();
  useEffect(() => setFresh(undefined), [loaded.data]);
  const e = fresh ?? loaded.data ?? undefined;
  useTitle(e?.title ?? t('Evento'));

  const [coverFailed, setCoverFailed] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [menu, setMenu] = useState(false);
  const [calMessage, setCalMessage] = useState<string | undefined>();
  const [creatingStory, setCreatingStory] = useState(false);
  const [viewing, setViewing] = useState<StoryPos | undefined>();
  const [storyGroups, setStoryGroups] = useState<import('../lib/types.ts').EventStoryGroup[]>([]);
  const [storiesKey, setStoriesKey] = useState(0);
  const storyIds = (fresh ?? loaded.data ?? undefined)?.storyUserIds.join(',') ?? '';
  useEffect(() => {
    if (!eventId || (!storyIds && storiesKey === 0)) return;
    let live = true;
    api.eventStories(eventId).then((r) => live && setStoryGroups(r.groups)).catch(() => live && setStoryGroups([]));
    return () => {
      live = false;
    };
  }, [eventId, storyIds, storiesKey]);
  const [posted, setPosted] = useState<boolean | undefined>();
  const [goBusy, setGoBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();
  const [tab, setTab] = useState<'feed' | 'info'>('feed');
  const [feedSettings, setFeedSettings] = useState<FeedSettings | undefined>();
  const search = useSearch();

  async function toggleGoing() {
    if (!e) return;
    setGoBusy(true);
    setProblem(undefined);
    try {
      setFresh(e.going ? await api.eventCancel(e.id) : await api.eventGo(e.id));
    } catch (failure) {
      setProblem(toApiError(failure).message);
    } finally {
      setGoBusy(false);
    }
  }

  const cover = e && !coverFailed ? coverSrc(e.coverPath) : null;
  const date = e ? eventDateLabel(e.startsAt, e.endsAt) : null;
  const time = e ? eventTimeLabel(e.startsAt, e.endsAt) : null;
  const strip = e ? attendeeStrip(e.attendees, e.confirmedCount, STRIP_MAX) : null;
  const ended = e ? Date.parse(e.endsAt) <= Date.now() : false;
  const canStory = e ? e.canStory : false;
  const isPosted = posted ?? e?.postedByMe ?? false;

  return (
    <>
      {waiting || loaded.loading ? <Loading /> : null}
      {!waiting && loaded.error ? (
        <>
          <button type="button" className="evpage__plainback" onClick={goBack}>
            <ChevronLeftIcon /> Voltar
          </button>
          <ErrorState message={loaded.error.message} onRetry={loaded.reload} />
        </>
      ) : null}
      {e && date && time && strip ? (
        <article className="evpage">
          <section className={`evhero evhero--${e.kind.toLowerCase()}`} aria-label={t('Capa do evento')}>
            {cover ? <img className="evhero__img" src={cover} alt="" referrerPolicy="no-referrer" onError={() => setCoverFailed(true)} /> : null}
            <div className="evhero__shade" aria-hidden="true" />
            <button type="button" className="evhero__btn evhero__btn--back" onClick={goBack} aria-label={t('Voltar')}>
              <ChevronLeftIcon />
            </button>
            <button type="button" className="evhero__btn evhero__btn--share" onClick={() => setMenu(true)} aria-label={t('Mais opções do evento')} aria-haspopup="dialog">
              <MoreIcon />
            </button>
            <div className="evhero__body">
              <span className="evhero__badge" title={kindLabel(e.kind)}>
                <EventKindIcon kind={e.kind} />
                <span className="visually-hidden">{kindLabel(e.kind)}</span>
              </span>
              <h1 className="evhero__title">{e.title}</h1>
              {e.venue.name || e.venue.address ? (
              <p className="evhero__place">
                {e.venue.id ? (
                  <Link to={`/bares/${encodeURIComponent(e.venue.id)}`} className="evhero__placelink">
                    {venueLine(e.venue)}
                  </Link>
                ) : (
                  venueLine(e.venue)
                )}
              </p>
              ) : null}
            </div>
          </section>

          <dl className="evstats">
            <div className="evstats__cell">
              <dt>{t('Confirmados')}</dt>
              <dd className="evstats__main">{e.confirmedCount}</dd>
              <dd className="evstats__sub">{e.confirmedCount === 1 ? 'pessoa' : 'pessoas'}</dd>
            </div>
            <div className="evstats__cell evstats__cell--date">
              <dt>
                {t('Data')}
                <button
                  type="button"
                  className="evstats__cal"
                  aria-label={t('Adicionar à agenda')}
                  title={t('Adicionar à agenda')}
                  onClick={() => {
                    setCalMessage(undefined);
                    addEventToCalendar(e).catch((failure: unknown) => setCalMessage(failure instanceof Error ? failure.message : t('Não foi possível adicionar à agenda.')));
                  }}
                >
                  <CalendarPlusIcon />
                </button>
              </dt>
              <dd className="evstats__main">{date.main}</dd>
              {date.sub ? <dd className="evstats__sub">{date.sub}</dd> : null}
            </div>
            <div className="evstats__cell">
              <dt>{t('Hora')}</dt>
              <dd className="evstats__main">{time.main}</dd>
              {time.sub ? <dd className="evstats__sub">{time.sub}</dd> : null}
            </div>
          </dl>
          <nav className="quickacts" aria-label={t('Ações rápidas do evento')}>
            {e.venue.lat !== null && e.venue.lng !== null ? (
              <OpenInMaps className="quickacts__btn" mode="route" lat={e.venue.lat} lng={e.venue.lng} label={e.venue.name}>
                <span className="quickacts__icon" aria-hidden="true"><RouteIcon /></span>
                <span className="quickacts__label">{t('Rota')}</span>
              </OpenInMaps>
            ) : null}
            {e.venue.name || e.venue.address || e.venue.lat !== null ? (
              <OpenInMaps className="quickacts__btn" lat={e.venue.lat} lng={e.venue.lng} label={e.venue.name} address={e.venue.address}>
                <span className="quickacts__icon" aria-hidden="true"><MapIcon /></span>
                <span className="quickacts__label">{t('Mapa')}</span>
              </OpenInMaps>
            ) : null}
            <button type="button" className="quickacts__btn" onClick={() => setSharing(true)}>
              <span className="quickacts__icon" aria-hidden="true"><ShareIcon /></span>
              <span className="quickacts__label">{t('Compartilhar')}</span>
            </button>
          </nav>
          {calMessage ? <Notice tone="error">{calMessage}</Notice> : null}

          <section className="evgoing" aria-label={t('Quem confirmou')}>
            {strip.shown.length > 0 || canStory ? (
              <ul className="evgoing__faces">
                {canStory ? (
                  <li>
                    <button type="button" className="evgoing__story" onClick={() => setCreatingStory(true)} aria-label={t('Criar story neste evento')}>
                      <span className="evgoing__storyring">
                        <PlusIcon />
                      </span>
                      <span className="evgoing__storylabel">{t('Seu story')}</span>
                    </button>
                  </li>
                ) : null}
                {strip.shown.map((p) => (
                  <li key={p.userId}>
                    {e.storyUserIds.includes(p.userId) && startOf(storyGroups, p.userId) ? (
                      <button type="button" className="evgoing__face evgoing__face--story" onClick={() => setViewing(startOf(storyGroups, p.userId) ?? undefined)} aria-label={t('Ver o story de {username}', { username: p.username })}>
                        <Avatar profile={p} size={40} />
                      </button>
                    ) : (
                      <Link to={`/u/${encodeURIComponent(p.username)}`} aria-label={t('Perfil de {username}', { username: p.username })}>
                        <Avatar profile={p} size={44} />
                      </Link>
                    )}
                  </li>
                ))}
                {strip.more > 0 ? (
                  <li>
                    <span className="evgoing__more" aria-label={t('mais {more} pessoas', { more: strip.more })}>
                      +{strip.more}
                    </span>
                  </li>
                ) : null}
              </ul>
            ) : (
              <p className="muted">{t('Ninguém confirmou ainda. Seja o primeiro.')}</p>
            )}
            {e.ticketUrl && !ended ? (
              <div className="evticket">
                <a className="btn btn--secondary btn--full evticket__link" href={e.ticketUrl} target="_blank" rel="noopener noreferrer nofollow sponsored" onClick={() => trackTicketClick(e.id)}>
                  <TicketIcon />
                  {t('Comprar ingresso')}
                </a>
                <p className="evticket__note">{t('Abre {host}. A venda é feita lá: o AskouT não cobra nem entrega o ingresso.', { host: ticketHost(e.ticketUrl) || t('o site de venda') })}</p>
              </div>
            ) : null}
            {e.isOwner ? null : ended ? (
              <p className="muted">{t('Esse evento já terminou.')}</p>
            ) : (
              // "Eu vou" e "Criar encontro" lado a lado quando os dois existem.
              <div className="evgo">
                <Button full variant={e.going ? 'secondary' : 'primary'} loading={goBusy} onClick={() => void toggleGoing()} aria-pressed={e.going}>
                  {e.going ? t('Eu vou ✓ (toque para cancelar)') : t('Eu vou')}
                </Button>
                {e.source === 'PLACE' ? (
                  <Button full variant="secondary" onClick={() => setPlanning(true)}>
                    {MEETUP_ACTION_LABEL}
                  </Button>
                ) : null}
              </div>
            )}
            {problem ? <Notice tone="error">{problem}</Notice> : null}
          </section>

          <div className="segtabs segtabs--fill evtabs" role="tablist" aria-label={t('Seções do evento')}>
            <button type="button" role="tab" aria-selected={tab === 'feed'} className="segtabs__tab" onClick={() => setTab('feed')}>
              {t('Publicações')}
            </button>
            <button type="button" role="tab" aria-selected={tab === 'info'} className="segtabs__tab" onClick={() => setTab('info')}>
              {t('Informações')}
            </button>
          </div>

          {tab === 'feed' ? (
            <Feed
              where="events"
              targetId={e.id}
              openPostId={search.get('post')}
              openPending={search.get('pendentes') === '1'}
              onSettings={setFeedSettings}
              intro={
                <div className="feedintro">
                  {e.description ? <p className="feedintro__text">{e.description}</p> : null}
                  <ul className="feedintro__facts">
                    <li>
                      <CalendarIcon /> {date.main}
                      {date.sub ? ` · ${date.sub}` : ''} · {time.main}
                    </li>
                    {e.venue.name || e.venue.address ? (
                      <li>
                        <LocationIcon /> {venueLine(e.venue)}
                      </li>
                    ) : null}
                    {e.owner ? (
                      <li>
                        <UserIcon /> {t('Organizado por')}{' '}
                        <Link to={`/u/${encodeURIComponent(e.owner.username)}`}>
                          <strong>{e.owner.username}</strong>
                        </Link>
                      </li>
                    ) : null}
                  </ul>
                  <button type="button" className="linkbtn" onClick={() => setTab('info')}>
                    {t('Ver todas as informações')}
                  </button>
                </div>
              }
            />
          ) : (
            <section className="evinfo" aria-label={t('Informações do evento')}>
              <div className="sugcard__tags">
                <span className="tag tag--event">{kindLabel(e.kind)}</span>
                {e.isFree ? <span className="tag tag--free">{t('Grátis')}</span> : null}
                {e.sample ? <SampleBadge /> : null}
                {e.distanceM !== null ? <span className="muted">{t('a {distance} de você', { distance: formatDistance(e.distanceM) })}</span> : null}
              </div>
              {e.owner ? (
                <p className="muted">
                  Organizado por{' '}
                  <Link to={`/u/${encodeURIComponent(e.owner.username)}`}>
                    <strong>{e.owner.username}</strong>
                  </Link>
                </p>
              ) : null}
              {e.description ? <p className="eventpage__text">{e.description}</p> : null}
              {e.tags.length > 0 ? (
                <ul className="tagchips">
                  {e.tags.map((t) => (
                    <li key={t}>
                      <button type="button" className="fchip" onClick={() => navigate(`/explorar?q=${encodeURIComponent(`#${t}`)}`)}>
                        #{t}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="evinfo__block">
                <h2 className="evinfo__title">{t('Quando')}</h2>
                <p>
                  {date.main}
                  {date.sub ? ` · ${date.sub}` : ''} · {time.main}
                  {time.sub ? ` ${time.sub}` : ''}
                </p>

              </div>
              {e.venue.name || e.venue.address ? (
                <div className="evinfo__block">
                  <h2 className="evinfo__title">{t('Onde')}</h2>
                  <p>{venueLine(e.venue)}</p>
                </div>
              ) : null}
              {e.source === 'PLACE' && !ended && e.isOwner ? (
                <div className="evactions">
                  <Button full variant="secondary" onClick={() => setPlanning(true)}>
                    {MEETUP_ACTION_LABEL}
                  </Button>
                </div>
              ) : null}
              {feedSettings ? (
                <div className="evinfo__block">
                  <h2 className="evinfo__title">{t('Publicações')}</h2>
                  <p className="muted">{policyNote(feedSettings)}</p>
                </div>
              ) : null}
            </section>
          )}
        </article>
      ) : null}
      {sharing && e ? (
        <ShareEventSheet
          eventId={e.id}
          source={e.source}
          title={e.title}
          posted={isPosted}
          onPostedChange={setPosted}
          profile={e.source === 'PLACE' ? 'toggle' : e.isPrivate ? 'private' : e.isOwner ? 'owner' : 'toggle'}
          outside={!e.isPrivate}
          onClose={() => setSharing(false)}
        />
      ) : null}
      {menu && e ? <EventMenuSheet page={e} onShare={() => { setMenu(false); setSharing(true); }} onClose={() => setMenu(false)} /> : null}
      {creatingStory && e ? (
        <StoryCreateSheet
          eventId={e.id}
          onClose={() => setCreatingStory(false)}
          onCreated={() => {
            setCreatingStory(false);
            setStoriesKey((k) => k + 1);
            loaded.reload();
          }}
        />
      ) : null}
      {viewing && e ? (
        <StoryViewer
          eventId={e.id}
          groups={storyGroups}
          start={viewing}
          onClose={() => setViewing(undefined)}
          onChanged={() => {
            setViewing(undefined);
            setStoriesKey((k) => k + 1);
            loaded.reload();
          }}
        />
      ) : null}
      {planning && e ? <CreateMeetupSheet event={{ id: e.id, title: e.title }} onClose={() => setPlanning(false)} /> : null}
    </>
  );
}
