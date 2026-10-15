import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { CreateMeetupSheet } from '../components/meetup.tsx';
import { Sheet } from '../components/agenda.tsx';
import { ChevronLeftIcon, EventKindIcon, MoreIcon, ShareIcon, TrashIcon, XIcon } from '../components/icons.tsx';
import { ShareEventSheet } from '../components/share-event.tsx';
import { SampleBadge } from '../components/suggestions.tsx';
import { Avatar, Button, ErrorState, Field, Loading, Notice } from '../components/ui.tsx';
import { api } from '../client.ts';
import { useAsync, useTitle } from '../hooks.ts';
import { mapLink, routeLink } from '../lib/chat.ts';
import { attendeeStrip, eventDateLabel, eventTimeLabel, venueLine, venueMapLink } from '../lib/event-page.ts';
import { kindLabel, safeImage } from '../lib/explore.ts';
import { formatDistance } from '../lib/flash.ts';
import { toApiError } from '../lib/errors.ts';
import { resizePostPhoto } from '../lib/image.ts';
import { MEETUP_ACTION_LABEL } from '../lib/meetup.ts';
import { timeAgo } from '../lib/format.ts';
import type { EventPage, EventPost } from '../lib/types.ts';
import { Link, navigate } from '../router.tsx';
import { useCurrentPosition } from './explore.tsx';

/** O mesmo texto máximo que a API aceita num post de evento. */
const EVENT_POST_CAPTION_MAX = 500;
/** Avatares na fileira; o resto vira "+N". */
const STRIP_MAX = 7;

/** Capa: endereço https (evento do local) ou caminho da própria API (foto enviada / foto assinada do Google). */
function coverSrc(path: string | null): string | null {
  if (!path) return null;
  return path.startsWith('/') ? api.assetUrl(path) : safeImage(path);
}

function goBack() {
  if (window.history.length > 1) window.history.back();
  else navigate('/explorar');
}

// ---------- Posts dentro do evento ----------

function EventPostSheet({ eventId, onClose, onCreated }: { eventId: string; onClose: () => void; onCreated: (post: EventPost) => void }) {
  const [caption, setCaption] = useState('');
  const [image, setImage] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  const input = useRef<HTMLInputElement>(null);

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setMessage(undefined);
    try {
      setImage(await resizePostPhoto(file));
    } catch (failure) {
      setMessage(failure instanceof Error ? failure.message : 'Não foi possível usar essa foto.');
    }
  }

  async function send() {
    setBusy(true);
    setMessage(undefined);
    try {
      onCreated(await api.createEventPost(eventId, { caption: caption.trim(), ...(image ? { image } : {}) }));
    } catch (failure) {
      setMessage(toApiError(failure).message);
      setBusy(false);
    }
  }

  return (
    <Sheet title="Postar no evento" onClose={onClose}>
      {message ? <Notice tone="error">{message}</Notice> : null}
      <Field label="Texto" value={caption} onChange={setCaption} multiline maxLength={EVENT_POST_CAPTION_MAX + 20} hint={`${Array.from(caption).length}/${EVENT_POST_CAPTION_MAX}`} autoFocus />
      {image ? (
        <div className="evpost__preview">
          <img src={image} alt="Foto do post" />
          <button type="button" className="iconbtn evpost__remove" onClick={() => setImage(undefined)} aria-label="Tirar a foto">
            <XIcon />
          </button>
        </div>
      ) : (
        <Button variant="secondary" full onClick={() => input.current?.click()}>
          Adicionar foto
        </Button>
      )}
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => void pick(e)} />
      <Button full loading={busy} disabled={caption.trim() === '' || Array.from(caption).length > EVENT_POST_CAPTION_MAX} onClick={() => void send()}>
        Postar
      </Button>
    </Sheet>
  );
}

function EventPostCard({ post, onDelete, busy }: { post: EventPost; onDelete: () => void; busy: boolean }) {
  const [failed, setFailed] = useState(false);
  return (
    <li className="evpost">
      <header className="evpost__head">
        <Link to={`/u/${encodeURIComponent(post.author.username)}`} className="evpost__author">
          <Avatar profile={post.author} size={32} />
          <strong>{post.author.username}</strong>
        </Link>
        <span className="muted evpost__when">{timeAgo(post.createdAt, new Date())}</span>
        {post.canDelete ? (
          <button type="button" className="iconbtn evpost__del" onClick={onDelete} disabled={busy} aria-label="Apagar este post do evento">
            <TrashIcon />
          </button>
        ) : null}
      </header>
      {post.imagePath && !failed ? <img className="evpost__img" src={api.assetUrl(post.imagePath)} alt="" loading="lazy" onError={() => setFailed(true)} /> : null}
      <p className="evpost__text">{post.caption}</p>
    </li>
  );
}

/** Menu ⋯ do evento: compartilhar e, para o dono, quem pode postar. */
function EventMenuSheet({ page, onChange, onShare, onClose }: { page: EventPage; onChange: (page: EventPage) => void; onShare: () => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | undefined>();

  async function choose(value: boolean) {
    if (value === page.postsPublic || busy) return;
    setBusy(true);
    setMessage(undefined);
    try {
      onChange(await api.eventPostsPublic(page.id, value));
      onClose();
    } catch (failure) {
      setMessage(toApiError(failure).message);
      setBusy(false);
    }
  }

  return (
    <Sheet title="Opções do evento" onClose={onClose}>
      {message ? <Notice tone="error">{message}</Notice> : null}
      <Button full variant="secondary" onClick={onShare}>
        <ShareIcon /> Compartilhar
      </Button>
      {page.isOwner && page.postsEnabled ? (
      <>
      <h3 className="radiolist__title">Quem pode postar</h3>
      <div className="radiolist" role="radiogroup" aria-label="Quem pode postar neste evento">
        <label className="radiolist__item">
          <input type="radio" name="quem-posta" checked={!page.postsPublic} disabled={busy} onChange={() => void choose(false)} />
          <span>
            <strong>Só eu</strong>
            <span className="muted radiolist__desc">Todos veem, mas só você publica.</span>
          </span>
        </label>
        <label className="radiolist__item">
          <input type="radio" name="quem-posta" checked={page.postsPublic} disabled={busy} onChange={() => void choose(true)} />
          <span>
            <strong>Eu e quem vai</strong>
            <span className="muted radiolist__desc">Quem confirmou presença também publica.</span>
          </span>
        </label>
      </div>
      </>
      ) : null}
    </Sheet>
  );
}

function EventPosts({ page, onChange }: { page: EventPage; onChange: (page: EventPage) => void }) {
  const [composing, setComposing] = useState(false);
  const [busyId, setBusyId] = useState<string | undefined>();
  const [message, setMessage] = useState<string | undefined>();

  async function remove(post: EventPost) {
    setBusyId(post.id);
    setMessage(undefined);
    try {
      await api.deleteEventPost(page.id, post.id);
      onChange({ ...page, posts: page.posts.filter((p) => p.id !== post.id) });
    } catch (failure) {
      setMessage(toApiError(failure).message);
    } finally {
      setBusyId(undefined);
    }
  }

  return (
    <section className="evposts" aria-labelledby="evposts-title">
      <div className="evposts__head">
        <h2 id="evposts-title" className="evposts__title">
          Posts do evento
        </h2>
        {page.canPost ? (
          <Button small onClick={() => setComposing(true)}>
            Postar
          </Button>
        ) : null}
      </div>
      {page.isOwner ? (
        <p className="muted">{page.postsPublic ? 'Você e quem confirmou presença podem postar.' : 'Só você posta neste evento.'} Mude no menu ⋯ do topo.</p>
      ) : page.postsPublic ? (
        <p className="muted">{page.going ? 'Você confirmou presença: pode postar aqui.' : 'Confirme presença para postar neste evento.'}</p>
      ) : (
        <p className="muted">Neste evento só quem organiza posta.</p>
      )}
      {message ? <Notice tone="error">{message}</Notice> : null}
      {page.posts.length === 0 ? (
        <p className="muted">{page.canPost ? 'Nenhum post ainda. Que tal abrir o assunto?' : 'Nenhum post ainda.'}</p>
      ) : (
        <ul className="evposts__list">
          {page.posts.map((post) => (
            <EventPostCard key={post.id} post={post} busy={busyId === post.id} onDelete={() => void remove(post)} />
          ))}
        </ul>
      )}
      {composing ? (
        <EventPostSheet
          eventId={page.id}
          onClose={() => setComposing(false)}
          onCreated={(post) => {
            setComposing(false);
            onChange({ ...page, posts: [post, ...page.posts] });
          }}
        />
      ) : null}
    </section>
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
  useTitle(e?.title ?? 'Evento');

  const [coverFailed, setCoverFailed] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [menu, setMenu] = useState(false);
  const [posted, setPosted] = useState<boolean | undefined>();
  const [goBusy, setGoBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();

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
          <section className={`evhero evhero--${e.kind.toLowerCase()}`} aria-label="Capa do evento">
            {cover ? <img className="evhero__img" src={cover} alt="" referrerPolicy="no-referrer" onError={() => setCoverFailed(true)} /> : null}
            <div className="evhero__shade" aria-hidden="true" />
            <button type="button" className="evhero__btn evhero__btn--back" onClick={goBack} aria-label="Voltar">
              <ChevronLeftIcon />
            </button>
            <button type="button" className="evhero__btn evhero__btn--share" onClick={() => setMenu(true)} aria-label="Mais opções do evento" aria-haspopup="dialog">
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
              <dt>Confirmados</dt>
              <dd className="evstats__main">{e.confirmedCount}</dd>
              <dd className="evstats__sub">{e.confirmedCount === 1 ? 'pessoa' : 'pessoas'}</dd>
            </div>
            <div className="evstats__cell">
              <dt>Data</dt>
              <dd className="evstats__main">{date.main}</dd>
              {date.sub ? <dd className="evstats__sub">{date.sub}</dd> : null}
            </div>
            <div className="evstats__cell">
              <dt>Hora</dt>
              <dd className="evstats__main">{time.main}</dd>
              {time.sub ? <dd className="evstats__sub">{time.sub}</dd> : null}
            </div>
          </dl>

          <section className="evgoing" aria-label="Quem confirmou">
            {strip.shown.length > 0 ? (
              <ul className="evgoing__faces">
                {strip.shown.map((p) => (
                  <li key={p.userId}>
                    <Link to={`/u/${encodeURIComponent(p.username)}`} aria-label={`Perfil de ${p.username}`}>
                      <Avatar profile={p} size={44} />
                    </Link>
                  </li>
                ))}
                {strip.more > 0 ? (
                  <li>
                    <span className="evgoing__more" aria-label={`mais ${strip.more} pessoas`}>
                      +{strip.more}
                    </span>
                  </li>
                ) : null}
              </ul>
            ) : (
              <p className="muted">Ninguém confirmou ainda. Seja o primeiro.</p>
            )}
            {e.isOwner ? null : ended ? (
              <p className="muted">Esse evento já terminou.</p>
            ) : (
              <Button full variant={e.going ? 'secondary' : 'primary'} loading={goBusy} onClick={() => void toggleGoing()} aria-pressed={e.going}>
                {e.going ? 'Eu vou ✓ (toque para cancelar)' : 'Eu vou'}
              </Button>
            )}
            {problem ? <Notice tone="error">{problem}</Notice> : null}
          </section>

          <div className="sugcard__tags">
            <span className="tag tag--event">{kindLabel(e.kind)}</span>
            {e.isFree ? <span className="tag tag--free">Grátis</span> : null}
            {e.sample ? <SampleBadge /> : null}
            {e.distanceM !== null ? <span className="muted">a {formatDistance(e.distanceM)} de você</span> : null}
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

          {e.postsEnabled ? <EventPosts page={e} onChange={setFresh} /> : null}

          <div className="evactions">
            {e.source === 'PLACE' && !ended ? (
              <Button full variant="secondary" onClick={() => setPlanning(true)}>
                {MEETUP_ACTION_LABEL}
              </Button>
            ) : null}
            <div className="sugcard__actions">
              {e.venue.lat !== null && e.venue.lng !== null ? (
                <a className="btn btn--quiet btn--small" href={routeLink(e.venue.lat, e.venue.lng)} target="_blank" rel="noopener noreferrer">
                  Rota até lá
                </a>
              ) : null}
              {e.venue.name || e.venue.address || e.venue.lat !== null ? (
                <a className="btn btn--quiet btn--small" href={e.venue.lat !== null && e.venue.lng !== null ? mapLink(e.venue.lat, e.venue.lng) : venueMapLink(e.venue)} target="_blank" rel="noopener noreferrer">
                  Mapa
                </a>
              ) : null}
            </div>
          </div>
        </article>
      ) : null}
      {sharing && e ? (
        <ShareEventSheet
          eventId={e.id}
          title={e.title}
          posted={isPosted}
          onPostedChange={setPosted}
          profile={e.source === 'PLACE' ? 'toggle' : e.isPrivate ? 'private' : e.isOwner ? 'owner' : 'toggle'}
          outside={!e.isPrivate}
          onClose={() => setSharing(false)}
        />
      ) : null}
      {menu && e ? <EventMenuSheet page={e} onChange={setFresh} onShare={() => { setMenu(false); setSharing(true); }} onClose={() => setMenu(false)} /> : null}
      {planning && e ? <CreateMeetupSheet event={{ id: e.id, title: e.title }} onClose={() => setPlanning(false)} /> : null}
    </>
  );
}
