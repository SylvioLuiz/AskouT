import { CloakroomCard } from '../components/cloakroom-card.tsx';
import { OpenInMaps } from '../components/open-in-maps.tsx';
import { shareOrigin } from '../lib/public-origin.ts';
import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { CreateMeetupSheet } from '../components/meetup.tsx';
import { StoryCreateSheet, StoryViewer } from '../components/event-story.tsx';
import { Sheet } from '../components/agenda.tsx';
import { EditPostSheet } from '../components/post-actions.tsx';
import { EventExtrasList } from '../components/event-extras.tsx';
import { CalendarIcon, CalendarPlusIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, EditIcon, EventKindIcon, LocationIcon, LockIcon, MapIcon, MoreIcon, PlusIcon, RouteIcon, ShareIcon, TicketIcon } from '../components/icons.tsx';
import { ShareEventSheet } from '../components/share-event.tsx';
import { SampleBadge } from '../components/suggestions.tsx';
import { Avatar, Button, ErrorState, Field, Loading, Notice } from '../components/ui.tsx';
import { api } from '../client.ts';
import { useAsync, useTitle } from '../hooks.ts';
import { startOf } from '../lib/stories.ts';
import type { StoryPos } from '../lib/stories.ts';
import { eventLink } from '../lib/share.ts';
import { attendeeStrip, eventDateLabel, eventLongDate, eventTimeLabel, venueLine } from '../lib/event-page.ts';
import { kindLabel, safeImage } from '../lib/explore.ts';
import { formatDistance } from '../lib/flash.ts';
import { ticketHost } from '../lib/venue.ts';
import { toApiError } from '../lib/errors.ts';
import { addToCalendar } from '../lib/ics.ts';
import { resizePostPhoto } from '../lib/image.ts';
import { MEETUP_ACTION_LABEL } from '../lib/meetup.ts';
import { timeAgo } from '../lib/format.ts';
import type { EventPage, FeedSettings, PostView } from '../lib/types.ts';
import { Feed } from '../components/feed.tsx';
import { policyNote } from '../lib/feed.ts';
import { Link, navigate, useSearch } from '../router.tsx';
import { useCurrentPosition } from './explore.tsx';
import { t } from '../lib/i18n/index.ts';
import { trackTicketClick } from '../components/sponsored-view.tsx';
import { GoingChoiceSheet } from '../components/going-choice.tsx';

/** O mesmo texto máximo que a API aceita num post de evento. */
const EVENT_POST_CAPTION_MAX = 500;
/** Avatares na fileira; o resto vira "+N". */
const STRIP_MAX = 7;
/** Descrição maior que isso começa recolhida, com "Ver mais". */
const ABOUT_CLAMP_CHARS = 220;

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

/** Menu ⋯ do evento: editar (quem criou o evento), compartilhar e adicionar à agenda. */
function EventMenuSheet({ page, onShare, onEdit, onClose }: { page: EventPage; onShare: () => void; onEdit: (post: PostView) => void; onClose: () => void }) {
  const [message, setMessage] = useState<string | undefined>();
  const [opening, setOpening] = useState(false);
  // O evento criado por uma pessoa é um post: edita pelo mesmo formulário de "Editar" do post.
  const canEdit = page.isOwner && page.source === 'USER';

  async function edit() {
    setMessage(undefined);
    setOpening(true);
    try {
      onEdit(await api.post(page.id));
    } catch (failure) {
      setMessage(toApiError(failure).message);
      setOpening(false);
    }
  }

  return (
    <Sheet title={t('Opções do evento')} onClose={onClose}>
      {message ? <Notice tone="error">{message}</Notice> : null}
      <div className="sheetactions">
      {canEdit ? (
        <Button full variant="secondary" loading={opening} onClick={() => edit()}>
          <EditIcon /> {t('Editar evento')}
        </Button>
      ) : null}
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
  const [editing, setEditing] = useState<PostView | undefined>();
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
  const [choosing, setChoosing] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();
  const search = useSearch();
  // Abre nas informações (o que quem recebeu o evento quer ver primeiro); link de publicação abre direto no feed.
  const [tab, setTab] = useState<'feed' | 'info'>(() => (search.get('post') || search.get('pendentes') === '1' ? 'feed' : 'info'));
  const [aboutOpen, setAboutOpen] = useState(false);
  const openPost = search.get('post');
  useEffect(() => {
    if (openPost) setTab('feed');
  }, [openPost]);
  const [feedSettings, setFeedSettings] = useState<FeedSettings | undefined>();

  async function toggleGoing() {
    if (!e) return;
    // Confirmar pergunta antes se o evento aparece na aba Eventos do perfil.
    if (!e.going) {
      setChoosing(true);
      return;
    }
    setGoBusy(true);
    setProblem(undefined);
    try {
      setFresh(await api.eventCancel(e.id));
    } catch (failure) {
      setProblem(toApiError(failure).message);
    } finally {
      setGoBusy(false);
    }
  }

  async function confirmGoing(onProfile: boolean) {
    if (!e) return;
    setGoBusy(true);
    setProblem(undefined);
    try {
      setFresh(await api.eventGo(e.id, onProfile));
      setChoosing(false);
    } catch (failure) {
      setProblem(toApiError(failure).message);
      setChoosing(false);
    } finally {
      setGoBusy(false);
    }
  }

  async function switchProfile() {
    if (!e) return;
    setGoBusy(true);
    setProblem(undefined);
    try {
      setFresh(await api.setGoingOnProfile(e.id, !e.goingOnProfile));
    } catch (failure) {
      setProblem(toApiError(failure).message);
    } finally {
      setGoBusy(false);
    }
  }

  function addToAgenda() {
    if (!e) return;
    setCalMessage(undefined);
    addEventToCalendar(e).catch((failure: unknown) => setCalMessage(failure instanceof Error ? failure.message : t('Não foi possível adicionar à agenda.')));
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
              <div className="evhero__pills">
                <span className="evhero__pill">{kindLabel(e.kind)}</span>
                {e.isFree ? <span className="evhero__pill">{t('Grátis')}</span> : null}
                {e.isPrivate ? (
                  <span className="evhero__pill evhero__pill--private">
                    <LockIcon /> {t('Evento privado')}
                  </span>
                ) : null}
              </div>
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

          {e.owner ? (
            <Link to={`/u/${encodeURIComponent(e.owner.username)}`} className="evhost">
              <Avatar profile={e.owner} size={44} />
              <span className="evhost__text">
                <span className="evhost__label">{t('Organizado por')}</span>
                <strong className="evhost__name">{e.owner.displayName || e.owner.username}</strong>
                {e.owner.displayName && e.owner.displayName !== e.owner.username ? <span className="evhost__user">@{e.owner.username}</span> : null}
              </span>
              <ChevronRightIcon />
            </Link>
          ) : null}
          {e.isPrivate && !e.isOwner ? <p className="evprivate"><LockIcon /> {t('Só quem recebeu o convite vê este evento.')}</p> : null}

          <dl className="evstats">
            <div className="evstats__cell">
              <dt>{t('Confirmados')}</dt>
              <dd className="evstats__main">{e.confirmedCount}</dd>
              <dd className="evstats__sub">{e.confirmedCount === 1 ? t('pessoa') : t('pessoas')}</dd>
            </div>
            <div className="evstats__cell">
              <dt>{t('Data')}</dt>
              <dd className="evstats__main">{date.main}</dd>
              {date.sub ? <dd className="evstats__sub">{date.sub}</dd> : null}
            </div>
            <div className="evstats__cell">
              <dt>{t('Hora')}</dt>
              <dd className="evstats__main">{time.main}</dd>
              {time.sub ? <dd className="evstats__sub">{time.sub}</dd> : null}
            </div>
          </dl>

          <section className="evgoing" aria-label={t('Presença')}>
            {e.isOwner ? null : ended ? (
              <p className="evgoing__ended">{t('Esse evento já terminou.')}</p>
            ) : (
              <>
                {/* "Eu vou" e "Criar encontro" lado a lado quando os dois existem. */}
                <div className="evgo">
                  <Button full variant={e.going ? 'secondary' : 'primary'} loading={goBusy} onClick={() => toggleGoing()} aria-pressed={e.going}>
                    {e.going ? (
                      <>
                        <CheckIcon /> {t('Você vai')}
                      </>
                    ) : (
                      t('Eu vou')
                    )}
                  </Button>
                  {e.source === 'PLACE' ? (
                    <Button full variant="secondary" onClick={() => setPlanning(true)}>
                      {MEETUP_ACTION_LABEL}
                    </Button>
                  ) : null}
                </div>
                {e.going ? <p className="evgo__hint">{t('Mudou de ideia? Toque em “Você vai” para cancelar.')}</p> : null}
                {e.going ? (
                  <p className="evgo__hint">
                    {e.goingOnProfile ? t('Aparece na aba Eventos do seu perfil.') : t('Fica na aba Participou do seu perfil, que só você vê.')}{' '}
                    <button type="button" className="linkbtn" onClick={() => void switchProfile()} disabled={goBusy}>
                      {e.goingOnProfile ? t('Tirar do perfil') : t('Mostrar no perfil')}
                    </button>
                  </p>
                ) : null}
                {choosing ? <GoingChoiceSheet busy={goBusy} onChoose={(onProfile) => void confirmGoing(onProfile)} onClose={() => setChoosing(false)} /> : null}
              </>
            )}
            {problem ? <Notice tone="error">{problem}</Notice> : null}
            {e.ticketUrl && !ended ? (
              <div className="evticket">
                <a className="btn btn--secondary btn--full evticket__link" href={e.ticketUrl} target="_blank" rel="noopener noreferrer nofollow sponsored" onClick={() => trackTicketClick(e.id)}>
                  <TicketIcon />
                  {t('Comprar ingresso')}
                </a>
                <p className="evticket__note">{t('Abre {host}. A venda é feita lá: o AskouT não cobra nem entrega o ingresso.', { host: ticketHost(e.ticketUrl) || t('o site de venda') })}</p>
              </div>
            ) : null}
          </section>

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
            <button type="button" className="quickacts__btn" onClick={addToAgenda}>
              <span className="quickacts__icon" aria-hidden="true"><CalendarPlusIcon /></span>
              <span className="quickacts__label">{t('Agenda')}</span>
            </button>
            <Link to={`/criar?tipo=post&evento=${encodeURIComponent(e.id)}&eventoNome=${encodeURIComponent(e.title)}`} className="quickacts__btn" aria-label={t('Publicar sobre o evento')}>
              <span className="quickacts__icon" aria-hidden="true"><PlusIcon /></span>
              <span className="quickacts__label">{t('Publicar')}</span>
            </Link>
            <button type="button" className="quickacts__btn" onClick={() => setSharing(true)}>
              <span className="quickacts__icon" aria-hidden="true"><ShareIcon /></span>
              <span className="quickacts__label">{t('Compartilhar')}</span>
            </button>
          </nav>
          {calMessage ? <Notice tone="error">{calMessage}</Notice> : null}

          {strip.shown.length > 0 || canStory ? (
            <section className="evwho" aria-label={t('Quem vai')}>
              <h2 className="evwho__title">
                {t('Quem vai')} <span className="evwho__count">{e.confirmedCount}</span>
              </h2>
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
                  <li key={p.userId} className="evwho__person">
                    {e.storyUserIds.includes(p.userId) && startOf(storyGroups, p.userId) ? (
                      <button type="button" className="evgoing__face evgoing__face--story" onClick={() => setViewing(startOf(storyGroups, p.userId) ?? undefined)} aria-label={t('Ver o story de {username}', { username: p.username })}>
                        <Avatar profile={p} size={40} />
                      </button>
                    ) : (
                      <Link to={`/u/${encodeURIComponent(p.username)}`} aria-label={t('Perfil de {username}', { username: p.username })}>
                        <Avatar profile={p} size={44} />
                      </Link>
                    )}
                    <span className="evwho__name" aria-hidden="true">{p.username}</span>
                  </li>
                ))}
                {strip.more > 0 ? (
                  <li className="evwho__person">
                    <span className="evgoing__more" aria-label={t('mais {more} pessoas', { more: strip.more })}>
                      +{strip.more}
                    </span>
                  </li>
                ) : null}
              </ul>
            </section>
          ) : !ended ? (
            <p className="evwho__empty">{t('Ninguém confirmou ainda. Seja o primeiro.')}</p>
          ) : null}

          <div className="segtabs segtabs--fill evtabs" role="tablist" aria-label={t('Seções do evento')}>
            <button type="button" role="tab" aria-selected={tab === 'info'} className="segtabs__tab" onClick={() => setTab('info')}>
              {t('Informações')}
            </button>
            <button type="button" role="tab" aria-selected={tab === 'feed'} className="segtabs__tab" onClick={() => setTab('feed')}>
              {t('Publicações')}
            </button>
          </div>

          {tab === 'feed' ? (
            <Feed where="events" targetId={e.id} openPostId={search.get('post')} openPending={search.get('pendentes') === '1'} onSettings={setFeedSettings} />
          ) : (
            <section className="evinfo" aria-label={t('Informações do evento')}>
              {e.description ? (
                <div className="evinfo__block">
                  <h2 className="evinfo__title">{t('Sobre')}</h2>
                  <p className={`eventpage__text evinfo__about${aboutOpen ? '' : ' evinfo__about--clamp'}`}>{e.description}</p>
                  {e.description.length > ABOUT_CLAMP_CHARS || e.description.split('\n').length > 4 ? (
                    <button type="button" className="evinfo__more" onClick={() => setAboutOpen((v) => !v)} aria-expanded={aboutOpen}>
                      {aboutOpen ? t('Ver menos') : t('Ver mais')}
                    </button>
                  ) : null}
                </div>
              ) : null}
              <div className="evinfo__block evinfo__row">
                <span className="evinfo__icon" aria-hidden="true"><CalendarIcon /></span>
                <div className="evinfo__main">
                  <h2 className="evinfo__title">{t('Quando')}</h2>
                  <p className="evinfo__strong">{eventLongDate(e.startsAt, e.endsAt)}</p>
                  <p className="evinfo__sub">
                    {time.main}
                    {time.sub ? ` ${time.sub}` : ''}
                  </p>
                  <button type="button" className="evinfo__more" onClick={addToAgenda}>
                    {t('Adicionar à agenda')}
                  </button>
                </div>
              </div>
              {e.venue.name || e.venue.address ? (
                <div className="evinfo__block evinfo__row">
                  <span className="evinfo__icon" aria-hidden="true"><LocationIcon /></span>
                  <div className="evinfo__main">
                    <h2 className="evinfo__title">{t('Onde')}</h2>
                    {e.venue.name ? (
                      e.venue.id ? (
                        <Link to={`/bares/${encodeURIComponent(e.venue.id)}`} className="evinfo__strong evinfo__link">
                          {e.venue.name}
                        </Link>
                      ) : (
                        <p className="evinfo__strong">{e.venue.name}</p>
                      )
                    ) : null}
                    {e.venue.address ? <p className="evinfo__sub">{e.venue.address}</p> : null}
                    {e.distanceM !== null ? <p className="evinfo__sub">{t('a {distance} de você', { distance: formatDistance(e.distanceM) })}</p> : null}
                    <OpenInMaps className="evinfo__more" lat={e.venue.lat} lng={e.venue.lng} label={e.venue.name} address={e.venue.address}>
                      {t('Abrir no mapa')}
                    </OpenInMaps>
                  </div>
                </div>
              ) : null}
              {e.extras && e.extras.length > 0 ? (
                <div className="evinfo__block">
                  <h2 className="evinfo__title">{t('Detalhes')}</h2>
                  <EventExtrasList extras={e.extras} />
                </div>
              ) : null}
              {e.tags.length > 0 || e.sample ? (
                <ul className="tagchips">
                  {e.sample ? (
                    <li>
                      <SampleBadge />
                    </li>
                  ) : null}
                  {e.tags.map((tag) => (
                    <li key={tag}>
                      <button type="button" className="fchip" onClick={() => navigate(`/explorar?q=${encodeURIComponent(`#${tag}`)}`)}>
                        #{tag}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {e.source === 'PLACE' && !ended && e.isOwner ? (
                <div className="evactions">
                  <Button full variant="secondary" onClick={() => setPlanning(true)}>
                    {MEETUP_ACTION_LABEL}
                  </Button>
                </div>
              ) : null}
              {e.source === 'PLACE' && !ended ? <CloakroomCard eventId={e.id} /> : null}
              <button type="button" className="evinfo__block evinfo__feedlink" onClick={() => setTab('feed')}>
                <span className="evinfo__title">{t('Publicações')}</span>
                <span className="muted">{feedSettings ? policyNote(feedSettings) : t('Avisos, fotos e comentários de quem vai.')}</span>
                <span className="evinfo__more">{t('Ver publicações')}</span>
              </button>
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
      {menu && e ? (
        <EventMenuSheet
          page={e}
          onShare={() => { setMenu(false); setSharing(true); }}
          onEdit={(post) => { setMenu(false); setEditing(post); }}
          onClose={() => setMenu(false)}
        />
      ) : null}
      {editing ? (
        <EditPostSheet
          post={editing}
          eventOnly
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            setCoverFailed(false);
            loaded.reload();
          }}
        />
      ) : null}
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
