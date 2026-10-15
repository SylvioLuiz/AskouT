import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Sheet } from '../components/agenda.tsx';
import { CoverPicker } from '../components/cover-picker.tsx';
import { PostList } from '../components/post.tsx';
import { PlacePhoto, SampleBadge } from '../components/suggestions.tsx';
import { Button, EmptyState, ErrorState, Field, Loading, Notice, PageHead } from '../components/ui.tsx';
import { api } from '../client.ts';
import { useAsync, useTitle } from '../hooks.ts';
import { formatWhen, routeLink } from '../lib/chat.ts';
import { toApiError } from '../lib/errors.ts';
import { kindLabel, safeImage } from '../lib/explore.ts';
import { resizePostPhoto } from '../lib/image.ts';
import type { VenueEvent, VenueProfile } from '../lib/types.ts';
import { DAY_LONG, VENUE_ADDRESS_MAX, VENUE_CATEGORY_MAX, VENUE_DESCRIPTION_MAX, VENUE_NAME_MAX, VENUE_POST_CAPTION_MAX, VENUE_POST_PHOTOS_MAX, applyToAll, draftFromProfile, hoursLines, openStatus, profileBody, profileProblem } from '../lib/venue-profile.ts';
import type { VenueProfileDraft } from '../lib/venue-profile.ts';
import { Link } from '../router.tsx';
import { VenueEventSheet } from './venues.tsx';

type Tab = 'about' | 'agenda' | 'posts';

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')).toUpperCase();
}

function VenueHero({ venue }: { venue: VenueProfile }) {
  const [failed, setFailed] = useState(false);
  const own = safeImage(venue.coverUrl);
  return (
    <section className="vhero">
      {own && !failed ? (
        <img className="vhero__img" src={own} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : venue.photoPath ? (
        <PlacePhoto path={venue.photoPath} author={venue.photoAuthor} />
      ) : (
        <div className="vhero__fallback" aria-hidden="true">
          {initialsOf(venue.name)}
        </div>
      )}
    </section>
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
    <Sheet title="Editar perfil do bar" onClose={onClose}>
      <div className="claim">
        <CoverPicker imageUrl={draft.imageUrl} imageData={draft.imageData} onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))} hint="Sem imagem, a página usa uma capa simples." />
        <Field label="Nome do bar" value={draft.name} onChange={(v) => set('name', v)} maxLength={VENUE_NAME_MAX} />
        <Field label="Tipo de lugar (opcional)" value={draft.category} onChange={(v) => set('category', v)} maxLength={VENUE_CATEGORY_MAX} placeholder="Bar, boteco, casa de shows…" />
        <Field label="Endereço (opcional)" value={draft.address} onChange={(v) => set('address', v)} maxLength={VENUE_ADDRESS_MAX} />
        <Field label="Sobre o bar (opcional)" value={draft.description} onChange={(v) => set('description', v)} multiline maxLength={VENUE_DESCRIPTION_MAX} hint="O que as pessoas encontram aí: música, comida, ambiente." />
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
    <Sheet title="Novo post do bar" onClose={onClose}>
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

export function VenuePageScreen({ venueId }: { venueId: string }) {
  const page = useAsync(() => api.venueProfile(venueId), [venueId]);
  const v = page.data;
  useTitle(v?.name ?? 'Bar');
  const [tab, setTab] = useState<Tab>('about');
  const [sheet, setSheet] = useState<'edit' | 'event' | 'post' | undefined>();
  const [followBusy, setFollowBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();
  const [postsKey, setPostsKey] = useState(0);
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
        <PageHead title="Bar" back="/explorar" />
        <Loading />
      </>
    );
  }
  if (!v) {
    return (
      <>
        <PageHead title="Bar" back="/explorar" />
        <ErrorState message={page.error?.message ?? 'Não foi possível abrir esta página.'} onRetry={page.reload} />
      </>
    );
  }

  const status = openStatus(v.hours, now);
  const lines = hoursLines(v.hours, now);
  const tabs: { id: Tab; label: string; n?: number }[] = [
    { id: 'about', label: 'Sobre' },
    { id: 'agenda', label: 'Agenda', n: v.upcomingEvents.length },
    { id: 'posts', label: 'Posts' },
  ];

  return (
    <>
      <PageHead title={v.name} back="/explorar" subtitle={[v.category, v.address].filter(Boolean).join(' · ') || undefined} />
      <VenueHero venue={v} />
      <div className="vhead">
        <div className="vhead__tags">
          {v.sample ? <SampleBadge /> : null}
          {status ? <span className={`tag ${status.open ? 'tag--free' : 'tag--osm'}`}>{status.label}</span> : null}
        </div>
        <p className="vhead__followers">
          {v.followerCount === 1 ? '1 seguidor' : `${v.followerCount} seguidores`}
        </p>
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
            <Link to={`/locais/${encodeURIComponent(v.id)}`} className="btn btn--quiet btn--small">
              Gerenciar eventos
            </Link>
          </div>
        ) : (
          <div className="vhead__actions">
            <Button variant={v.following ? 'secondary' : 'primary'} loading={followBusy} aria-pressed={v.following} onClick={() => void toggleFollow()}>
              {v.following ? 'Seguindo' : 'Seguir'}
            </Button>
            <a className="btn btn--quiet" href={routeLink(v.lat, v.lng)} target="_blank" rel="noopener noreferrer">
              Rota
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
          <h2 className="vabout__h">Horário de funcionamento</h2>
          {lines.length > 0 ? (
            <ul className="vhours">
              {lines.map((l) => (
                <li key={l.day} className={l.today ? 'vhours__row vhours__row--today' : 'vhours__row'}>
                  <span>{l.label}</span>
                  <span>{l.text}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">{v.isOwner ? 'Informe os horários em Editar perfil.' : 'O bar ainda não informou os horários.'}</p>
          )}
          {v.address ? <p className="vabout__addr">{v.address}</p> : null}
        </section>
      ) : null}

      {tab === 'agenda' ? (
        v.upcomingEvents.length === 0 ? (
          <EmptyState title="Nenhum evento marcado">{v.isOwner ? 'Toque em Novo evento para divulgar a próxima atração.' : 'Quando o bar divulgar eventos, eles aparecem aqui.'}</EmptyState>
        ) : (
          <ul className="vagenda" aria-label="Próximos eventos">
            {v.upcomingEvents.map((e) => (
              <AgendaRow key={e.id} event={e} now={now} />
            ))}
          </ul>
        )
      ) : null}

      {tab === 'posts' ? <PostList load={(offset) => api.venuePosts(v.id, { limit: 6, offset })} emptyTitle="Ainda não há posts" emptyHint={v.isOwner ? 'Toque em Novo post para publicar fotos do bar.' : 'Os posts do bar aparecem aqui e no seu feed se você seguir.'} reloadKey={String(postsKey)} /> : null}

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
      {sheet === 'event' ? (
        <VenueEventSheet
          venueId={v.id}
          onClose={() => setSheet(undefined)}
          onSaved={() => {
            setSheet(undefined);
            page.reload();
            setTab('agenda');
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
    </>
  );
}
