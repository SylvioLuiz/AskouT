import { useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { Sheet } from '../components/agenda.tsx';
import { CoverPicker } from '../components/cover-picker.tsx';
import { PostList } from '../components/post.tsx';
import { PlacePhoto, SampleBadge } from '../components/suggestions.tsx';
import { ChevronDownIcon, ChevronLeftIcon, ClockIcon, LocationIcon, ShareIcon, StarIcon } from '../components/icons.tsx';
import { ShareLinkSheet } from '../components/post-actions.tsx';
import { Avatar, Button, EmptyState, ErrorState, Field, Loading, Notice, PageHead } from '../components/ui.tsx';
import { api } from '../client.ts';
import { useAsync, useTitle } from '../hooks.ts';
import { formatRating, formatWhen, routeLink, starPercent } from '../lib/chat.ts';
import { distanceMeters, formatDistance } from '../lib/flash.ts';
import { useCurrentPosition } from './explore.tsx';
import { toApiError } from '../lib/errors.ts';
import { kindLabel, safeImage } from '../lib/explore.ts';
import { resizePostPhoto } from '../lib/image.ts';
import type { VenueEvent, VenueProfile } from '../lib/types.ts';
import { DAY_LONG, VENUE_ADDRESS_MAX, VENUE_CATEGORY_MAX, VENUE_DESCRIPTION_MAX, VENUE_NAME_MAX, VENUE_POST_CAPTION_MAX, VENUE_POST_PHOTOS_MAX, applyToAll, daysSummary, draftFromProfile, friendsWentLabel, hoursLines, openStatus, profileBody, profileProblem } from '../lib/venue-profile.ts';
import type { VenueProfileDraft } from '../lib/venue-profile.ts';
import { Link, navigate } from '../router.tsx';
import { VenueEventRow, VenueEventSheet } from './venues.tsx';

type Tab = 'about' | 'events' | 'regulars' | 'posts';

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')).toUpperCase();
}

function PinIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" />
    </svg>
  );
}

function goBack() {
  if (window.history.length > 1) window.history.back();
  else navigate('/explorar');
}

/** Topo da página: capa (a fachada) ao fundo, logo em círculo, nome, localização e os três números. */
/** Estrelas para avaliar o rolê, na própria linha da nota: toque na nota; tocar de novo na mesma tira a avaliação. Cinco estrelas ganham uma animação sutil. */
function StarPicker({ venue, onChanged }: { venue: VenueProfile; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();
  const [cheer, setCheer] = useState(0);
  const mine = venue.rating.mine;
  async function pick(stars: number) {
    if (busy) return;
    setBusy(true);
    setProblem(undefined);
    try {
      if (mine === stars) await api.clearVenueRating(venue.id);
      else {
        await api.rateVenue(venue.id, stars);
        if (stars === 5) setCheer((n) => n + 1);
      }
      onChanged();
    } catch (failure) {
      setProblem(toApiError(failure).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="vrate">
      <div key={cheer} className={`vrate__stars${cheer > 0 && mine === 5 ? ' vrate__stars--five' : ''}`} role="group" aria-label={mine ? `Sua nota: ${mine} de 5` : 'Toque para dar a sua nota de 1 a 5'}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" className={`vrate__star${mine !== null && n <= mine ? ' vrate__star--on' : ''}`} aria-pressed={mine === n} aria-label={`${n} ${n === 1 ? 'estrela' : 'estrelas'}`} disabled={busy} onClick={() => void pick(n)}>
            ★
          </button>
        ))}
        <span className="vrate__label">{mine ? 'Sua nota' : 'Avaliar'}</span>
      </div>
      {problem ? <p className="field__error">{problem}</p> : null}
    </div>
  );
}

/** Linha de informação no estilo "ficha do lugar": ícone, conteúdo e, quando abre, uma seta. */
function InfoRow({ icon, children, open, onToggle, label }: { icon: ReactNode; children: ReactNode; open?: boolean; onToggle?: () => void; label?: string }) {
  const body = (
    <>
      <span className="vinfo__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="vinfo__body">{children}</span>
      {onToggle ? (
        <span className={`vinfo__chev${open ? ' vinfo__chev--open' : ''}`} aria-hidden="true">
          <ChevronDownIcon />
        </span>
      ) : null}
    </>
  );
  return onToggle ? (
    <button type="button" className="vinfo vinfo--btn" aria-expanded={open} aria-label={label} onClick={onToggle}>
      {body}
    </button>
  ) : (
    <div className="vinfo">{body}</div>
  );
}

/** Horário de funcionamento: fechado mostra o estado e o dia de hoje; aberto (sanfona), a semana toda. */
function HoursInfo({ venue, now }: { venue: VenueProfile; now: Date }) {
  const [open, setOpen] = useState(false);
  const lines = hoursLines(venue.hours, now);
  const status = openStatus(venue.hours, now);
  if (lines.length === 0) {
    return <InfoRow icon={<ClockIcon />}><span className="muted">{venue.isOwner ? 'Informe os horários em Editar perfil.' : 'O rolê ainda não informou os horários.'}</span></InfoRow>;
  }
  const today = lines.find((l) => l.today);
  return (
    <>
      <InfoRow icon={<ClockIcon />} open={open} onToggle={() => setOpen((o) => !o)} label={open ? 'Esconder os horários da semana' : 'Ver os horários da semana'}>
        <span className={`vinfo__status${status ? (status.closingSoon ? ' vinfo__status--soon' : status.open ? ' vinfo__status--open' : ' vinfo__status--closed') : ''}`}>{status?.label ?? 'Horário de funcionamento'}</span>
        {today && !open ? <span className="vinfo__sub">Hoje: {today.text}</span> : null}
      </InfoRow>
      {open ? (
        <ul className="vhours vhours--panel">
          {lines.map((l) => (
            <li key={l.day} className={l.today ? 'vhours__row vhours__row--today' : 'vhours__row'}>
              <span>{l.label}</span>
              <span>{l.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

/** Nota do rolê: média, estrelas e quantas avaliações; quem não é dono avalia na mesma linha. */
function RatingInfo({ venue, onChanged }: { venue: VenueProfile; onChanged: () => void }) {
  const r = venue.rating;
  return (
    <InfoRow icon={<StarIcon />}>
      <span className="vinfo__rate">
        {r.count > 0 ? (
          <>
            <strong>{formatRating(r.average ?? 0)}</strong>
            <span className="vinfo__stars" aria-hidden="true" style={{ ['--fill' as string]: `${starPercent(r.average ?? 0)}%` }}>
              ★★★★★
            </span>
            <span className="vinfo__sub vinfo__sub--inline">
              {r.count} {r.count === 1 ? 'avaliação' : 'avaliações'}
            </span>
          </>
        ) : (
          <span className="vinfo__sub vinfo__sub--inline">Ainda sem avaliações</span>
        )}
      </span>
      {!venue.isOwner ? <StarPicker venue={venue} onChanged={onChanged} /> : null}
    </InfoRow>
  );
}

function VenueHero({ venue, now, onShare }: { venue: VenueProfile; now: Date; onShare: () => void }) {
  const [coverFailed, setCoverFailed] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const own = safeImage(venue.coverUrl);
  const google = own === null && venue.photoPath ? api.assetUrl(venue.photoPath) : null;
  const bg = !coverFailed ? (own ?? google) : null;
  const logo = !logoFailed ? safeImage(venue.logoUrl) : null;
  const status = openStatus(venue.hours, now);
  const days = daysSummary(venue.hours);
  const place = venue.address ?? venue.category;
  return (
    <header className="vhero">
      {bg ? <img className="vhero__bg" src={bg} alt="" referrerPolicy="no-referrer" onError={() => setCoverFailed(true)} /> : null}
      <div className="vhero__shade" />
      <button type="button" className="vhero__back" onClick={goBack} aria-label="Voltar">
        <ChevronLeftIcon />
      </button>
      <button type="button" className="vhero__share" onClick={onShare} aria-label="Compartilhar página do rolê">
        <ShareIcon />
      </button>
      <div className="vhero__body">
        {logo ? (
          <img className="vhero__logo" src={logo} alt={`Logo de ${venue.name}`} onError={() => setLogoFailed(true)} />
        ) : (
          <span className="vhero__logo vhero__logo--initials" aria-hidden="true">
            {initialsOf(venue.name)}
          </span>
        )}
        <h1 className="vhero__name">{venue.name}</h1>
        {place ? (
          <p className="vhero__place">
            <PinIcon />
            <span>{place}</span>
          </p>
        ) : null}
        <p className="vhero__rating" aria-label={venue.rating.count > 0 ? `Nota ${formatRating(venue.rating.average ?? 0)} de 5, ${venue.rating.count} ${venue.rating.count === 1 ? 'avaliação' : 'avaliações'}` : 'Ainda sem avaliações'}>
          {venue.rating.count > 0 ? (
            <>
              <span aria-hidden="true">★ {formatRating(venue.rating.average ?? 0)}</span>
              <span aria-hidden="true"> · {venue.rating.count} {venue.rating.count === 1 ? 'avaliação' : 'avaliações'}</span>
            </>
          ) : (
            <span aria-hidden="true">Ainda sem avaliações</span>
          )}
        </p>
        {venue.friendsWent.count > 0 ? (
          <p className="vhero__friends">
            <span className="vhero__faces" aria-hidden="true">
              {venue.friendsWent.sample.map((p) => (
                <Avatar key={p.userId} profile={p} size={24} />
              ))}
            </span>
            <span>{friendsWentLabel(venue.friendsWent)}</span>
          </p>
        ) : null}
        {venue.sample ? <SampleBadge /> : null}
      </div>
      <dl className="vstats">
        <div className="vstat vstat--followers">
          <dd className="vstat__value">{venue.followerCount}</dd>
          <dt className="vstat__label">{venue.followerCount === 1 ? 'Seguidor' : 'Seguidores'}</dt>
        </div>
        <div className="vstat vstat--days">
          <dd className="vstat__value">{days ?? '—'}</dd>
          <dt className="vstat__label">Funcionamento</dt>
        </div>
        <div className={`vstat vstat--hours${status ? (status.closingSoon ? ' vstat--soon' : status.open ? ' vstat--open' : '') : ''}`}>
          <dd className="vstat__value">{status ? status.short : '—'}</dd>
          <dt className="vstat__label">Horário</dt>
        </div>
      </dl>
      {google && !coverFailed ? <p className="vhero__credit">Foto: {venue.photoAuthor ? `${venue.photoAuthor} · ` : ''}Google</p> : null}
    </header>
  );
}

function AgendaRow({ event, now }: { event: VenueEvent; now: Date }) {
  return (
    <li className="vagenda__item">
      <Link to={`/eventos/${encodeURIComponent(event.id)}`} className="vagenda__link">
        <strong className="vagenda__title">{event.title}</strong>
        <span className="vagenda__when">{formatWhen(event.startsAt, event.endsAt, now)}</span>
        <span className="vagenda__meta">
          {kindLabel(event.kind)}
          {event.isFree ? ' · Grátis' : ''}
          {event.phase === 'LIVE' ? ' · Acontecendo agora' : ''}
        </span>
      </Link>
    </li>
  );
}

function HoursEditor({ draft, onChange }: { draft: VenueProfileDraft; onChange: (days: VenueProfileDraft['days']) => void }) {
  const firstOpen = [1, 2, 3, 4, 5, 6, 0].find((i) => draft.days[i]!.open);
  const set = (i: number, patch: Partial<VenueProfileDraft['days'][number]>) => onChange(draft.days.map((d, k) => (k === i ? { ...d, ...patch } : d)));
  return (
    <fieldset className="hours">
      <legend className="field__label">Horário de funcionamento</legend>
      {[1, 2, 3, 4, 5, 6, 0].map((i) => {
        const d = draft.days[i]!;
        return (
          <div key={i} className="hours__row">
            <label className="hours__day">
              <input type="checkbox" checked={d.open} onChange={(e) => set(i, { open: e.target.checked })} />
              <span>{DAY_LONG[i]}</span>
            </label>
            {d.open ? (
              <span className="hours__times">
                <input type="time" aria-label={`Abre ${DAY_LONG[i]}`} value={d.from} onChange={(e) => set(i, { from: e.target.value })} />
                <span aria-hidden="true">às</span>
                <input type="time" aria-label={`Fecha ${DAY_LONG[i]}`} value={d.to} onChange={(e) => set(i, { to: e.target.value })} />
                {i === firstOpen ? (
                  <button type="button" className="linkbtn" onClick={() => onChange(applyToAll(draft.days, i))}>
                    Copiar para todos
                  </button>
                ) : null}
              </span>
            ) : (
              <span className="hours__closed">Fechado</span>
            )}
          </div>
        );
      })}
      <p className="field__hint">Se fechar de madrugada, é só colocar a hora do dia seguinte (ex.: abre 18:00, fecha 02:00).</p>
    </fieldset>
  );
}

function ProfileEditSheet({ venue, onClose, onSaved }: { venue: VenueProfile; onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState<VenueProfileDraft>(() => draftFromProfile(venue));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  const set = <K extends keyof VenueProfileDraft>(key: K, value: VenueProfileDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  async function save() {
    const problem = profileProblem(draft);
    if (problem) {
      setMessage(problem);
      return;
    }
    setBusy(true);
    setMessage(undefined);
    try {
      await api.updateVenueProfile(venue.id, profileBody(draft));
      onSaved();
    } catch (failure) {
      setMessage(toApiError(failure).message);
      setBusy(false);
    }
  }

  return (
    <Sheet title="Editar perfil do rolê" onClose={onClose}>
      <div className="claim">
        <CoverPicker imageUrl={draft.imageUrl} imageData={draft.imageData} onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))} hint="Foto de fundo da página, de preferência a fachada do rolê." />
        <CoverPicker logo imageUrl={draft.logoUrl} imageData={draft.logoData} onChange={(patch) => setDraft((d) => ({ ...d, ...(patch.imageUrl !== undefined ? { logoUrl: patch.imageUrl } : {}), ...(patch.imageData !== undefined ? { logoData: patch.imageData } : {}) }))} hint="Aparece em círculo sobre a capa." />
        <Field label="Nome do rolê" value={draft.name} onChange={(v) => set('name', v)} maxLength={VENUE_NAME_MAX} />
        <Field label="Tipo de rolê (opcional)" value={draft.category} onChange={(v) => set('category', v)} maxLength={VENUE_CATEGORY_MAX} placeholder="Bar, balada, casa de shows…" />
        <Field label="Endereço (opcional)" value={draft.address} onChange={(v) => set('address', v)} maxLength={VENUE_ADDRESS_MAX} />
        <Field label="Sobre o rolê (opcional)" value={draft.description} onChange={(v) => set('description', v)} multiline maxLength={VENUE_DESCRIPTION_MAX} hint="O que as pessoas encontram aí: música, comida, ambiente." />
        <HoursEditor draft={draft} onChange={(days) => set('days', days)} />
        {message ? <Notice tone="error">{message}</Notice> : null}
        <Button full loading={busy} onClick={save}>
          Salvar
        </Button>
      </div>
    </Sheet>
  );
}

function VenuePostSheet({ venueId, onClose, onSaved }: { venueId: string; onClose: () => void; onSaved: () => void }) {
  const [photos, setPhotos] = useState<string[]>([]);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  const fileRef = useRef<HTMLInputElement>(null);

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).slice(0, VENUE_POST_PHOTOS_MAX - photos.length);
    e.target.value = '';
    if (files.length === 0) return;
    setReading(true);
    setMessage(undefined);
    try {
      const done: string[] = [];
      for (const f of files) done.push(await resizePostPhoto(f));
      setPhotos((cur) => [...cur, ...done].slice(0, VENUE_POST_PHOTOS_MAX));
    } catch (failure) {
      setMessage(failure instanceof Error ? failure.message : 'Não foi possível usar essa foto.');
    } finally {
      setReading(false);
    }
  }

  async function publish() {
    if (photos.length === 0) {
      setMessage('Escolha pelo menos uma foto.');
      return;
    }
    setBusy(true);
    setMessage(undefined);
    try {
      await api.createVenuePost(venueId, { images: photos, ...(caption.trim() !== '' ? { caption: caption.trim() } : {}) });
      onSaved();
    } catch (failure) {
      setMessage(toApiError(failure).message);
      setBusy(false);
    }
  }

  return (
    <Sheet title="Novo post do rolê" onClose={onClose}>
      <div className="claim">
        {photos.length > 0 ? (
          <ul className="vpost__thumbs" aria-label="Fotos do post">
            {photos.map((src, i) => (
              <li key={i}>
                <img src={src} alt={`Foto ${i + 1}`} />
                <button type="button" className="vpost__remove" aria-label={`Tirar foto ${i + 1}`} onClick={() => setPhotos((cur) => cur.filter((_, k) => k !== i))}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {photos.length < VENUE_POST_PHOTOS_MAX ? (
          <Button variant="secondary" full loading={reading} onClick={() => fileRef.current?.click()}>
            {photos.length === 0 ? 'Escolher fotos do aparelho' : 'Adicionar mais fotos'}
          </Button>
        ) : null}
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={pick} aria-label="Escolher fotos do aparelho" />
        <Field label="Legenda (opcional)" value={caption} onChange={setCaption} multiline maxLength={VENUE_POST_CAPTION_MAX} />
        {message ? <Notice tone="error">{message}</Notice> : null}
        <Button full loading={busy} onClick={publish}>
          Publicar
        </Button>
      </div>
    </Sheet>
  );
}

/** Aba de eventos de quem administra: todos (os que já passaram também), com editar e apagar. */
function OwnerEvents({ venueId, now, reloadKey, onNew, onEdit, onChanged }: { venueId: string; now: Date; reloadKey: number; onNew: () => void; onEdit: (e: VenueEvent) => void; onChanged: () => void }) {
  const panel = useAsync(() => api.venuePanel(venueId), [venueId, reloadKey]);
  return (
    <section className="vowner">
      <Button full onClick={onNew}>
        Novo evento
      </Button>
      {panel.loading && !panel.data ? <Loading /> : null}
      {panel.error && !panel.data ? <ErrorState message={panel.error.message} onRetry={panel.reload} /> : null}
      {panel.data && panel.data.events.length === 0 ? <EmptyState title="Nenhum evento ainda">Os eventos que você criar aparecem aqui e no Explorar para quem está perto.</EmptyState> : null}
      {panel.data && panel.data.events.length > 0 ? (
        <ul className="velist" aria-label="Eventos do rolê">
          {panel.data.events.map((e) => (
            <VenueEventRow
              key={e.id}
              venueId={venueId}
              event={e}
              now={now}
              onEdit={() => onEdit(e)}
              onChanged={() => {
                panel.reload();
                onChanged();
              }}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export function VenuePageScreen({ venueId }: { venueId: string }) {
  const page = useAsync(() => api.venueProfile(venueId), [venueId]);
  const v = page.data;
  useTitle(v?.name ?? 'Rolê');
  const [tab, setTab] = useState<Tab>('about');
  const [sheet, setSheet] = useState<'edit' | 'event' | 'post' | undefined>();
  const [followBusy, setFollowBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();
  const [sharing, setSharing] = useState(false);
  const where = useCurrentPosition();
  const [postsKey, setPostsKey] = useState(0);
  const [eventsKey, setEventsKey] = useState(0);
  const [editing, setEditing] = useState<VenueEvent | undefined>();
  const now = new Date();

  async function toggleFollow() {
    if (!v || followBusy) return;
    setFollowBusy(true);
    setProblem(undefined);
    try {
      if (v.following) await api.unfollowVenue(v.id);
      else await api.followVenue(v.id);
      page.reload();
    } catch (failure) {
      setProblem(toApiError(failure).message);
    } finally {
      setFollowBusy(false);
    }
  }

  if (page.loading && !v) {
    return (
      <>
        <PageHead title="Rolê" back="/explorar" />
        <Loading />
      </>
    );
  }
  if (!v) {
    return (
      <>
        <PageHead title="Rolê" back="/explorar" />
        <ErrorState message={page.error?.message ?? 'Não foi possível abrir esta página.'} onRetry={page.reload} />
      </>
    );
  }

  const lines = hoursLines(v.hours, now);
  const tabs: { id: Tab; label: string; n?: number }[] = [
    { id: 'about', label: 'Sobre' },
    { id: 'events', label: 'Eventos', n: v.upcomingEvents.length },
    { id: 'regulars', label: 'Ranking' },
    { id: 'posts', label: 'Posts' },
  ];

  return (
    <>
      <VenueHero venue={v} now={now} onShare={() => setSharing(true)} />
      <div className="vhead">
        {v.isOwner ? (
          <div className="vhead__actions">
            <Button small onClick={() => setSheet('edit')}>
              Editar perfil
            </Button>
            <Button small variant="secondary" onClick={() => setSheet('event')}>
              Novo evento
            </Button>
            <Button small variant="secondary" onClick={() => setSheet('post')}>
              Novo post
            </Button>
            <Button small variant="secondary" onClick={() => navigate(`/bares/${encodeURIComponent(v.id)}/impulsionar`)}>
              Impulsionar
            </Button>
            <Button small variant="secondary" onClick={() => navigate(`/bares/${encodeURIComponent(v.id)}/agenda`)}>
              Agenda
            </Button>
          </div>
        ) : (
          <div className="vhead__actions">
            <Button variant={v.following ? 'secondary' : 'primary'} loading={followBusy} aria-pressed={v.following} onClick={() => void toggleFollow()}>
              {v.following ? 'Seguindo' : 'Seguir'}
            </Button>
            <a className="btn btn--quiet" href={routeLink(v.lat, v.lng)} target="_blank" rel="noopener noreferrer">
              Rota{where.status === 'ok' ? ` · a ${formatDistance(distanceMeters(where.position, { lat: v.lat, lng: v.lng }))}` : ''}
            </a>
          </div>
        )}
        {problem ? <Notice tone="error">{problem}</Notice> : null}
        {!v.claimed ? (
          <p className="muted vhead__unclaimed">
            Esta página ainda não tem responsável. <Link to="/locais">É o dono? Peça para administrar.</Link>
          </p>
        ) : null}
      </div>

      <div className="segtabs segtabs--fill" role="tablist" aria-label="Seções da página">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className="segtabs__tab" onClick={() => setTab(t.id)}>
            {t.label}
            {t.n ? <span className="segtabs__n">{t.n}</span> : null}
          </button>
        ))}
      </div>

      {tab === 'about' ? (
        <section className="vabout">
          {v.description ? <p className="vabout__text">{v.description}</p> : v.isOwner ? <p className="muted">Conte o que as pessoas encontram aí. Toque em Editar perfil.</p> : null}
          <div className="vinfolist">
            <HoursInfo venue={v} now={now} />
            {v.address ? (
              <InfoRow icon={<LocationIcon />}>
                <span className="vinfo__addr">{v.address}</span>
                <a className="vinfo__sub vinfo__link" href={routeLink(v.lat, v.lng)} target="_blank" rel="noopener noreferrer">
                  Como chegar
                </a>
              </InfoRow>
            ) : v.isOwner ? (
              <InfoRow icon={<LocationIcon />}>
                <span className="muted">Informe o endereço em Editar perfil.</span>
              </InfoRow>
            ) : null}
            <RatingInfo venue={v} onChanged={page.reload} />
          </div>
        </section>
      ) : null}

      {tab === 'events' ? (
        v.isOwner ? (
          <OwnerEvents venueId={v.id} now={now} reloadKey={eventsKey} onNew={() => setSheet('event')} onEdit={(e) => setEditing(e)} onChanged={page.reload} />
        ) : v.upcomingEvents.length === 0 ? (
          <EmptyState title="Nenhum evento marcado">Quando o rolê divulgar eventos, eles aparecem aqui.</EmptyState>
        ) : (
          <ul className="vagenda" aria-label="Próximos eventos">
            {v.upcomingEvents.map((e) => (
              <AgendaRow key={e.id} event={e} now={now} />
            ))}
          </ul>
        )
      ) : null}

      {tab === 'regulars' ? (
        v.regulars.length === 0 ? (
          <EmptyState title="O ranking ainda está vazio">Quem confirmar presença nos eventos de {v.name} e for aparece aqui.</EmptyState>
        ) : (
          <>
            <ol className="vrank" aria-label="Quem mais frequenta">
              {v.regulars.map((r) => (
                <li key={r.user.userId} className={`vrank__row${r.rank <= 3 ? ' vrank__row--top' : ''}`}>
                  <span className="vrank__pos" aria-label={`${r.rank}º lugar`}>
                    {r.rank}
                  </span>
                  <Link to={`/u/${encodeURIComponent(r.user.username)}`} className="vrank__who">
                    <Avatar profile={r.user} size={40} />
                    <span className="vrank__name">
                      <strong>{r.user.username}</strong>
                      {r.user.displayName ? <span className="muted">{r.user.displayName}</span> : null}
                    </span>
                  </Link>
                  <span className="vrank__n">
                    {r.visits} {r.visits === 1 ? 'presença' : 'presenças'}
                  </span>
                </li>
              ))}
            </ol>
            <p className="muted vrank__note">Conta as presenças confirmadas em eventos do local que já aconteceram. Perfis privados só aparecem para quem os segue.</p>
          </>
        )
      ) : null}

      {tab === 'posts' ? <PostList load={(offset) => api.venuePosts(v.id, { limit: 6, offset })} emptyTitle="Ainda não há posts" emptyHint={v.isOwner ? 'Toque em Novo post para publicar fotos do rolê.' : 'Os posts do rolê aparecem aqui e no seu feed se você seguir.'} reloadKey={String(postsKey)} /> : null}

      {sheet === 'edit' ? (
        <ProfileEditSheet
          venue={v}
          onClose={() => setSheet(undefined)}
          onSaved={() => {
            setSheet(undefined);
            page.reload();
          }}
        />
      ) : null}
      {sheet === 'event' || editing ? (
        <VenueEventSheet
          venueId={v.id}
          {...(editing ? { event: editing } : {})}
          onClose={() => {
            setSheet(undefined);
            setEditing(undefined);
          }}
          onSaved={() => {
            setSheet(undefined);
            setEditing(undefined);
            setEventsKey((k) => k + 1);
            page.reload();
            setTab('events');
          }}
        />
      ) : null}
      {sheet === 'post' ? (
        <VenuePostSheet
          venueId={v.id}
          onClose={() => setSheet(undefined)}
          onSaved={() => {
            setSheet(undefined);
            setPostsKey((k) => k + 1);
            setTab('posts');
          }}
        />
      ) : null}
      {sharing ? <ShareLinkSheet url={`${window.location.origin}/bares/${encodeURIComponent(v.id)}`} text={`${v.name} no AskouT`} onClose={() => setSharing(false)} /> : null}
    </>
  );
}
