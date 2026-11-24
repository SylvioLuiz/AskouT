import { CloakroomCard } from '../components/cloakroom-card.tsx';
import { OpenInMaps } from '../components/open-in-maps.tsx';
import { shareOrigin } from '../lib/public-origin.ts';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ChangeEvent, PointerEvent, TouchEvent } from 'react';
import { useHoldPreview } from '../components/hold-preview.ts';
import { CreateMeetupSheet } from '../components/meetup.tsx';
import { StoryViewer } from '../components/event-story.tsx';
import { StoryCreator } from '../components/story-creator.tsx';
import { Sheet } from '../components/agenda.tsx';
import { EditPostSheet } from '../components/post-actions.tsx';
import { EventInviteSheet } from '../components/event-invite-picker.tsx';
import { EventExtrasList } from '../components/event-extras.tsx';
import { CalendarIcon, CalendarPlusIcon, ChatIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, EditIcon, EventKindIcon, LocationIcon, LockIcon, MapIcon, MoreIcon, PlusIcon, RouteIcon, ShareIcon, TicketIcon, UsersIcon } from '../components/icons.tsx';
import { ShareEventSheet } from '../components/share-event.tsx';
import { SampleBadge } from '../components/suggestions.tsx';
import { Avatar, Button, EmptyState, ErrorState, Field, Loading, Notice } from '../components/ui.tsx';
import { AlbumContent } from './albums.tsx';
import { api, session } from '../client.ts';
import { useIsVisitor } from '../auth.tsx';
import { askLogin } from '../components/visitor.tsx';
import { useAsync, useTitle } from '../hooks.ts';
import type { StoryPos } from '../lib/stories.ts';
import { eventLink } from '../lib/share.ts';
import { attendeeStrip, eventDateLabel, eventLongDate, eventTimeLabel, venueShort } from '../lib/event-page.ts';
import { eventTone, kindLabel, safeImage } from '../lib/explore.ts';
import { formatDistance } from '../lib/flash.ts';
import { ticketHost } from '../lib/venue.ts';
import { toApiError } from '../lib/errors.ts';
import { addToCalendar } from '../lib/ics.ts';
import { resizePostPhoto } from '../lib/image.ts';
import { MEETUP_ACTION_LABEL } from '../lib/meetup.ts';
import { timeAgo } from '../lib/format.ts';
import type { EventPage, FeedSettings, PostView } from '../lib/types.ts';
import { Feed } from '../components/feed.tsx';
import { GuestListCard } from '../components/guest-list.tsx';
import { policyNote } from '../lib/feed.ts';
import { Link, navigate, useSearch, goBack as routerGoBack } from '../router.tsx';
import { useCurrentPosition } from './explore.tsx';
import { t } from '../lib/i18n/index.ts';
import { trackTicketClick } from '../components/sponsored-view.tsx';
import { splitEventTitle } from '../lib/event-title.ts';
import { LiveTag } from '../components/live-tag.tsx';
import { GoingChoiceSheet } from '../components/going-choice.tsx';
import { EventSkeleton } from '../components/skeletons.tsx';

/** O mesmo texto máximo que a API aceita num post de evento. */
const EVENT_POST_CAPTION_MAX = 500;
/** Avatares na fileira; o resto vira "+N". */
const STRIP_MAX = 7;
/** Quantos rostos sobrepostos aparecem antes do "+N". */
const WHO_STACK = 6;
/** Descrição maior que isso começa recolhida, com "Ver mais". */
const ABOUT_CLAMP_CHARS = 220;

/** Capa: endereço https (evento do local) ou caminho da própria API (foto enviada / foto assinada do Google). */
/** Vídeo da capa, enquanto a pessoa segura: tenta com som (o toque libera) e, se o navegador recusar, toca sem. */
function HeroVideo({ src, poster }: { src: string; poster: string | null }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.muted = false;
    void video.play().catch(() => {
      video.muted = true;
      void video.play().catch(() => undefined);
    });
  }, []);
  return <video ref={ref} className="evhero__img evhero__video" src={src} poster={poster ?? undefined} playsInline loop preload="auto" aria-label={t('Vídeo da capa')} />;
}

function coverSrc(path: string | null): string | null {
  if (!path) return null;
  return path.startsWith('/') ? api.assetUrl(path) : safeImage(path);
}

/** Cria o arquivo de agenda do evento e abre na agenda (ou baixa, no navegador). */
async function addEventToCalendar(page: EventPage): Promise<void> {
  if (!page.startsAt || !page.endsAt) throw new Error(t('A data ainda está em votação.'));
  await addToCalendar({ id: page.id, title: page.title, description: page.description, startsAt: page.startsAt, endsAt: page.endsAt, venue: page.venue.name ? { name: page.venue.name, address: page.venue.address } : null, url: eventLink(shareOrigin(), page.id) });
}

function goBack() {
  // Visitante não tem Explorar: volta para a Home.
  routerGoBack(session.get() === undefined ? '/' : '/explorar');
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

// ---------- Álbum ----------

/** Aba Álbum: fotos de quem foi. Abre quando o evento começa; quem não confirmou presença vê como entrar. */
function EventAlbumTab({ eventId, onGo }: { eventId: string; onGo: () => void }) {
  const album = useAsync(() => api.eventAlbum(eventId), [eventId]);
  if (album.loading && !album.data) return <Loading shape="grid" />;
  if (album.error) return <ErrorState message={album.error.message} onRetry={album.reload} />;
  const data = album.data;
  if (!data) return null;
  if (data.state === 'OPEN') return <section className="evalbum" aria-label={t('Álbum do evento')}><AlbumContent albumId={data.album.id} embedded /></section>;
  if (data.state === 'SOON') {
    return (
      <EmptyState title={t('O álbum abre quando o evento começar')}>
        {t('A partir de {when}, quem confirmou presença coloca as fotos do rolê aqui.', { when: eventLongDate(data.startsAt, data.startsAt) })}
      </EmptyState>
    );
  }
  return (
    <EmptyState title={t('Álbum de quem foi')} action={<Button onClick={onGo}>{t('Eu vou')}</Button>}>
      {t('Só quem confirmou presença vê e adiciona fotos. Marque “Eu vou” para entrar no álbum.')}
    </EmptyState>
  );
}

// ---------- Página ----------

export function EventScreen({ eventId }: { eventId: string }) {
  const visitor = useIsVisitor();
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
  const [inviting, setInviting] = useState(false);
  const [calMessage, setCalMessage] = useState<string | undefined>();
  /** Lista completa de quem vai (abre ao tocar nos rostos). */
  const [whoOpen, setWhoOpen] = useState(false);
  /** Dono convidando mais amigos a partir de "Quem vai" (o convite sai na hora) e o aviso de quantos foram. */
  const [invitingFriends, setInvitingFriends] = useState(false);
  const [inviteNote, setInviteNote] = useState<string | undefined>();
  const [creatingStory, setCreatingStory] = useState(false);
  /** Tocou em "Seu flash" sem ter marcado que vai: aviso de que só quem vai posta. */
  const [storyNeedsGoing, setStoryNeedsGoing] = useState(false);
  /** Marcou que vai a partir desse aviso: abre a criação do flash assim que confirmar. */
  const storyAfterGoing = useRef(false);
  /** Flash aberto: a fila (começando em quem foi tocado) e a posição nela. */
  const [viewing, setViewing] = useState<{ groups: import('../lib/types.ts').EventStoryGroup[]; start: StoryPos } | undefined>();
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
  const [groupBusy, setGroupBusy] = useState(false);
  const [groupProblem, setGroupProblem] = useState<string | undefined>();
  const search = useSearch();
  // Abre nas informações (o que quem recebeu o evento quer ver primeiro); link de publicação abre direto no feed.
  const [tab, setTab] = useState<'feed' | 'info' | 'album'>(() => (search.get('post') || search.get('pendentes') === '1' ? 'feed' : search.get('aba') === 'album' ? 'album' : 'info'));
  const [aboutOpen, setAboutOpen] = useState(false);
  const openPost = search.get('post');
  useEffect(() => {
    if (openPost) setTab('feed');
  }, [openPost]);
  const [feedSettings, setFeedSettings] = useState<FeedSettings | undefined>();

  async function toggleGoing() {
    if (!e) return;
    if (visitor) {
      askLogin(t('Entre para dizer “Eu vou”, ver quem vai e receber os avisos do evento.'));
      return;
    }
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

  /** Quem criou o evento cria o grupo dele (ou cai no que já existe) e vai para a conversa. */
  async function createGroup() {
    if (!e) return;
    setGroupBusy(true);
    setGroupProblem(undefined);
    try {
      const { id: conversationId } = await api.createEventGroup(e.id);
      navigate(`/conversas/${encodeURIComponent(conversationId)}`);
    } catch (failure) {
      setGroupProblem(toApiError(failure).message);
    } finally {
      setGroupBusy(false);
    }
  }

  async function confirmGoing(onProfile: boolean) {
    if (!e) return;
    setGoBusy(true);
    setProblem(undefined);
    try {
      const updated = await api.eventGo(e.id, onProfile);
      setFresh(updated);
      setChoosing(false);
      if (storyAfterGoing.current && updated.canStory) setCreatingStory(true);
      storyAfterGoing.current = false;
    } catch (failure) {
      setProblem(toApiError(failure).message);
      setChoosing(false);
      storyAfterGoing.current = false;
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
  // Capa em vídeo: segurar a capa toca o vídeo; soltar volta para a foto.
  const coverVideo = e?.coverVideoPath ? api.assetUrl(e.coverVideoPath) : null;
  const [playingCover, setPlayingCover] = useState(false);
  const holdCover = useHoldPreview(() => setPlayingCover(true), () => setPlayingCover(false));
  // Segurar os botões da capa (voltar, ⋯) não toca o vídeo.
  const onControl = (target: EventTarget) => target instanceof Element && target.closest('button, a') !== null;
  const coverPress = coverVideo
    ? {
        ...holdCover,
        onTouchStart: (event: TouchEvent<HTMLElement>) => {
          if (!onControl(event.target)) holdCover.onTouchStart(event);
        },
        onPointerDown: (event: PointerEvent<HTMLElement>) => {
          if (!onControl(event.target)) holdCover.onPointerDown(event);
        },
      }
    : {};
  const date = e ? eventDateLabel(e.startsAt, e.endsAt) : null;
  const time = e ? eventTimeLabel(e.startsAt, e.endsAt) : null;
  const strip = e ? attendeeStrip(e.attendees, e.confirmedCount, STRIP_MAX) : null;
  const ended = e?.endsAt ? Date.parse(e.endsAt) <= Date.now() : false;
  const canStory = e ? e.canStory : false;
  // O botão de postar flash fica sempre à vista enquanto o evento não acabou; quem ainda não marcou que vai vê um aviso.
  const titleParts = splitEventTitle(e?.title ?? '');
  const titleRef = useRef<HTMLHeadingElement>(null);
  // Título que ocupa 3 linhas ou mais ganha fonte um pouco menor.
  useLayoutEffect(() => {
    const h = titleRef.current;
    if (!h) return;
    h.classList.remove('evhero__title--small');
    const lh = parseFloat(getComputedStyle(h).lineHeight) || 1;
    if (h.getBoundingClientRect().height / lh >= 2.8) h.classList.add('evhero__title--small');
  }, [e?.title]);
  const showStoryButton = e ? canStory || !ended : false;
  const isPosted = posted ?? e?.postedByMe ?? false;
  // Quem criou o evento chama mais amigos direto da lista de quem vai (o mesmo seletor da criação).
  const canInviteFriends = !visitor && e?.isOwner === true && e.source === 'USER' && !ended;

  return (
    <>
      {waiting || loaded.loading ? <EventSkeleton onBack={goBack} /> : null}
      {!waiting && loaded.error ? (
        <>
          <button type="button" className="evpage__plainback" onClick={goBack}>
            <ChevronLeftIcon /> {t('Voltar')}
          </button>
          <ErrorState message={loaded.error.message} onRetry={loaded.reload} />
        </>
      ) : null}
      {e && date && time && strip ? (
        <article className="evpage">
          <section {...coverPress} className={`evhero evhero--${e.kind.toLowerCase()} evtone evtone-${eventTone(e.id)}${coverVideo ? ' evhero--video' : ''}`} aria-label={t('Capa do evento')}>
            {cover ? <img className="evhero__img" src={cover} alt="" referrerPolicy="no-referrer" onError={() => setCoverFailed(true)} /> : null}
            {coverVideo && playingCover ? <HeroVideo src={coverVideo} poster={cover} /> : null}
            {coverVideo && !playingCover ? (
              <span className="evhero__videohint" aria-hidden="true">
                ▶ {t('Segure para ver o vídeo')}
              </span>
            ) : null}
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
                {e.startsAt && e.endsAt && Date.parse(e.startsAt) <= Date.now() && Date.now() < Date.parse(e.endsAt) ? <LiveTag /> : null}
                <span className="evhero__pill">{kindLabel(e.kind)}</span>
                {e.isFree ? <span className="evhero__pill">{t('Grátis')}</span> : null}
                {e.isPrivate ? (
                  <span className="evhero__pill evhero__pill--private">
                    <LockIcon /> {t('Evento privado')}
                  </span>
                ) : null}
              </div>
              <h1 className="evhero__title" ref={titleRef}>
                {titleParts.lead ? <span className="evhero__lead">{titleParts.lead}</span> : null}
                {titleParts.rest}
              </h1>
              {e.venue.name || e.venue.address ? (
              <p className="evhero__place">
                {e.venue.id ? (
                  <Link to={`/bares/${encodeURIComponent(e.venue.id)}`} className="evhero__placelink">
                    <LocationIcon />
                    <span className="evhero__placetext">{venueShort(e.venue)}</span>
                  </Link>
                ) : (
                  <span className="evhero__placelink evhero__placelink--plain">
                    <LocationIcon />
                    <span className="evhero__placetext">{venueShort(e.venue)}</span>
                  </span>
                )}
              </p>
              ) : null}
            </div>
          </section>

          {/* No celular é transparente (display: contents); no computador vira a coluna da direita, ao lado da capa. */}
          <div className="evpage__main">

          {!visitor && (showStoryButton || storyGroups.length > 0) ? (
            <section className="homestories evflashes" aria-label={t('Flashes do evento')}>
              <ul className="homestories__list">
                {showStoryButton ? (
                  <li>
                    <button type="button" className="homestories__item" onClick={() => (canStory ? setCreatingStory(true) : e.isOwner ? setProblem(t('Esse evento já terminou: não dá mais para postar flash.')) : setStoryNeedsGoing(true))} aria-label={t('Criar flash neste evento')}>
                      <span className="evflashes__add">
                        <PlusIcon />
                      </span>
                      <span className="homestories__name">{t('Seu flash')}</span>
                    </button>
                  </li>
                ) : null}
                {storyGroups.map((group, index) => (
                  <li key={group.author.userId}>
                    <button type="button" className="homestories__item" onClick={() => setViewing({ groups: storyGroups, start: { group: index, item: 0 } })} aria-label={group.mine ? t('Ver o seu flash') : t('Ver o flash de {username}', { username: group.author.username })}>
                      <span className="homestories__ring">
                        <Avatar profile={group.author} size={60} />
                      </span>
                      <span className="homestories__name">{group.mine ? t('Você') : group.author.username}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

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
          {/* Grupo do evento: aparece só para quem está nele; quem criou o evento e ainda não tem grupo pode criar. */}
          {!visitor && e.group ? (
            <Link to={`/conversas/${encodeURIComponent(e.group.conversationId)}`} className="evhost evgroup">
              <span className="evgroup__icon" aria-hidden="true">
                <ChatIcon />
              </span>
              <span className="evhost__text">
                <span className="evhost__label">{t('Grupo do evento')}</span>
                <strong className="evhost__name">{e.group.name || t('Abrir o grupo')}</strong>
              </span>
              <ChevronRightIcon />
            </Link>
          ) : !visitor && e.canCreateGroup && !ended ? (
            <div className="evgroup__create">
              <Button full variant="secondary" loading={groupBusy} onClick={() => void createGroup()}>
                <ChatIcon /> {t('Criar grupo do evento')}
              </Button>
              <p className="evgo__hint">{t('Entram seus amigos que foram convidados ou confirmaram. Depois dá para adicionar mais gente pelo grupo.')}</p>
              {groupProblem ? <Notice tone="error">{groupProblem}</Notice> : null}
            </div>
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
            {e.isOwner ? (
              ended ? null : (
                // Quem criou chama mais gente: o evento chega na conversa e a pessoa vira convidada (e vota na data, se houver votação).
                <div className="evgo">
                  <Button full onClick={() => setInviting(true)}>
                    <UsersIcon /> {t('Convidar')}
                  </Button>
                  {/* Evento sem data: abrir a votação (se ainda não tem) ou ir para ela, onde o lápis edita. */}
                  {e.startsAt === null ? (
                    <Button
                      full
                      variant="secondary"
                      onClick={() =>
                        navigate(e.datePollId ? `/planejar/${encodeURIComponent(e.datePollId)}` : `/planejar/evento/${encodeURIComponent(e.id)}?${new URLSearchParams({ titulo: e.title }).toString()}`)
                      }
                    >
                      <CalendarIcon /> {e.datePollId ? t('Ver e editar a votação') : t('Abrir a votação da data')}
                    </Button>
                  ) : null}
                </div>
              )
            ) : e.datePollId && !ended ? (
              // Convidado de um evento sem data: vota na data.
              <div className="evgo">
                <Button full onClick={() => navigate(`/planejar/${encodeURIComponent(e.datePollId ?? '')}`)}>
                  <CalendarIcon /> {t('Votar na data')}
                </Button>
              </div>
            ) : ended ? (
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
                    <Button full variant="secondary" onClick={() => (visitor ? askLogin(t('Entre para combinar um encontro com seus amigos.')) : setPlanning(true))}>
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
                {choosing ? <GoingChoiceSheet {...(e.startsAt && e.endsAt ? { event: { id: e.id, startsAt: e.startsAt, endsAt: e.endsAt } } : {})} busy={goBusy} onChoose={(onProfile) => void confirmGoing(onProfile)} onClose={() => { setChoosing(false); storyAfterGoing.current = false; }} /> : null}
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
            {visitor ? (
              <button type="button" className="quickacts__btn" aria-label={t('Publicar sobre o evento')} onClick={() => askLogin(t('Entre para publicar fotos e comentários sobre o evento.'))}>
                <span className="quickacts__icon" aria-hidden="true"><PlusIcon /></span>
                <span className="quickacts__label">{t('Publicar')}</span>
              </button>
            ) : (
              <Link to={`/criar?tipo=post&evento=${encodeURIComponent(e.id)}&eventoNome=${encodeURIComponent(e.title)}`} className="quickacts__btn" aria-label={t('Publicar sobre o evento')}>
                <span className="quickacts__icon" aria-hidden="true"><PlusIcon /></span>
                <span className="quickacts__label">{t('Publicar')}</span>
              </Link>
            )}
            <button type="button" className="quickacts__btn" onClick={() => (visitor ? askLogin(t('Entre para mandar o evento para seus amigos.')) : setSharing(true))}>
              <span className="quickacts__icon" aria-hidden="true"><ShareIcon /></span>
              <span className="quickacts__label">{t('Compartilhar')}</span>
            </button>
          </nav>
          {calMessage ? <Notice tone="error">{calMessage}</Notice> : null}

          {visitor ? null : e.confirmedCount > 0 ? (
            <section className="evwho" aria-label={t('Quem vai')}>
              <h2 className="evwho__title">
                {t('Quem vai')} <span className="evwho__count">{e.confirmedCount}</span>
              </h2>
              {(() => {
                const faces = strip.shown.slice(0, WHO_STACK);
                const rest = e.confirmedCount - faces.length;
                return (
                  <button type="button" className="evwho__stack" onClick={() => setWhoOpen(true)} aria-label={t('Ver as {n} pessoas que vão', { n: e.confirmedCount })}>
                    <span className="evwho__faces" aria-hidden="true">
                      {faces.map((p) => (
                        <Avatar key={p.userId} profile={p} size={40} />
                      ))}
                      {rest > 0 ? <span className="evwho__rest">+{rest}</span> : null}
                    </span>
                    <span className="evwho__see">{t('Ver todos')}</span>
                  </button>
                );
              })()}
            </section>
          ) : !ended ? (
            <p className="evwho__empty">{e.isOwner ? t('Ninguém confirmou ainda.') : t('Ninguém confirmou ainda. Seja o primeiro.')}</p>
          ) : null}
          {canInviteFriends ? (
            <div className="evwho__invite">
              <Button small variant="secondary" onClick={() => setInvitingFriends(true)}>
                <PlusIcon /> {t('Convidar mais pessoas')}
              </Button>
            </div>
          ) : null}
          {inviteNote ? <Notice tone="ok">{inviteNote}</Notice> : null}

          {whoOpen ? (
            <Sheet title={t('Quem vai ({n})', { n: e.confirmedCount })} onClose={() => setWhoOpen(false)}>
              <ul className="evwho__list">
                {e.attendees.map((p) => (
                  <li key={p.userId} className="evwho__item">
                    <Avatar profile={p} size={44} />
                    <Link to={`/u/${encodeURIComponent(p.username)}`} className="evwho__who" onClick={() => setWhoOpen(false)}>
                      <strong>{p.displayName}</strong>
                      <span>@{p.username}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              {e.confirmedCount > e.attendees.length ? <p className="muted evwho__more">{e.confirmedCount - e.attendees.length === 1 ? t('e mais 1 pessoa') : t('e mais {n} pessoas', { n: e.confirmedCount - e.attendees.length })}</p> : null}
              {canInviteFriends ? (
                <Button full variant="secondary" onClick={() => { setWhoOpen(false); setInvitingFriends(true); }}>
                  <PlusIcon /> {t('Convidar mais pessoas')}
                </Button>
              ) : null}
            </Sheet>
          ) : null}
          {invitingFriends ? (
            <EventInviteSheet
              eventId={e.id}
              onInvite={(n) => {
                setInvitingFriends(false);
                setInviteNote(n === 0 ? t('Essas pessoas já estavam convidadas.') : n === 1 ? t('1 pessoa convidada.') : t('{n} pessoas convidadas.', { n }));
                loaded.reload();
              }}
              onClose={() => setInvitingFriends(false)}
            />
          ) : null}

          {e.source === 'PLACE' && !visitor ? <GuestListCard eventId={e.id} ended={ended} /> : null}

          {visitor ? null : (
          <div className="segtabs segtabs--fill evtabs" role="tablist" aria-label={t('Seções do evento')}>
            <button type="button" role="tab" aria-selected={tab === 'info'} className="segtabs__tab" onClick={() => setTab('info')}>
              {t('Informações')}
            </button>
            <button type="button" role="tab" aria-selected={tab === 'feed'} className="segtabs__tab" onClick={() => setTab('feed')}>
              {t('Publicações')}
            </button>
            <button type="button" role="tab" aria-selected={tab === 'album'} className="segtabs__tab" onClick={() => setTab('album')}>
              {t('Álbum')}
            </button>
          </div>
          )}

          {tab === 'album' && !visitor ? (
            <EventAlbumTab key={String(e.going)} eventId={e.id} onGo={() => void toggleGoing()} />
          ) : tab === 'feed' && !visitor ? (
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
                    {e.distanceM !== null && !visitor ? <p className="evinfo__sub">{t('a {distance} de você', { distance: formatDistance(e.distanceM) })}</p> : null}
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
              {e.source === 'PLACE' && !ended && !visitor ? <CloakroomCard eventId={e.id} /> : null}
              {visitor ? null : (
              <button type="button" className="evinfo__block evinfo__feedlink" onClick={() => setTab('feed')}>
                <span className="evinfo__title">{t('Publicações')}</span>
                <span className="muted">{feedSettings ? policyNote(feedSettings) : t('Avisos, fotos e comentários de quem vai.')}</span>
                <span className="evinfo__more">{t('Ver publicações')}</span>
              </button>
              )}
            </section>
          )}
          </div>
        </article>
      ) : null}
      {inviting && e ? (
        <ShareEventSheet
          eventId={e.id}
          source={e.source}
          title={e.title}
          posted={isPosted}
          onPostedChange={setPosted}
          profile={e.source === 'PLACE' ? 'toggle' : e.isPrivate ? 'private' : 'owner'}
          outside={!e.isPrivate}
          sheetTitle={t('Convidar pessoas')}
          invite
          onClose={() => setInviting(false)}
        />
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
      {storyNeedsGoing && e ? (
        <Sheet title={t('Só quem vai pode postar')} onClose={() => setStoryNeedsGoing(false)}>
          <p>{t('Os flashes deste evento são de quem vai. Marque que você vai para postar o seu.')}</p>
          <Button
            full
            onClick={() => {
              setStoryNeedsGoing(false);
              storyAfterGoing.current = true;
              void toggleGoing();
            }}
          >
            {t('Eu vou')}
          </Button>
        </Sheet>
      ) : null}
      {creatingStory && e ? (
        <StoryCreator
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
          groups={viewing.groups}
          start={viewing.start}
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
