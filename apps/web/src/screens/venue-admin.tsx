import { useState } from 'react';
import { VenueLogo } from '../components/venue-logo.tsx';
import { Avatar, Button, Confirm, EmptyState, ErrorState, Field, Loading, Notice, PageHead } from '../components/ui.tsx';
import { api } from '../client.ts';
import { useAsync, useTitle } from '../hooks.ts';
import { formatRating, formatWhen } from '../lib/chat.ts';
import { toApiError } from '../lib/errors.ts';
import type { TeamMember, VenueEvent } from '../lib/types.ts';
import { CheckinQrSheet } from './checkin.tsx';
import { VenueStorySheet } from '../components/venue-story.tsx';
import { navigate } from '../router.tsx';
import { AgendaRow, HoursInfo, InfoRow, OwnerEvents, ProfileEditSheet, VenueHero, VenuePostSheet } from './venue-page.tsx';
import { LocationIcon } from '../components/icons.tsx';
import type { VenueProfile } from '../lib/types.ts';
import { VenueEventSheet } from './venues.tsx';
import { t } from '../lib/i18n/index.ts';

/** Raiz do modo estabelecimento: `/bares/:id/painel`, `/equipe`, `/eventos`, `/agenda`, `/impulsionar`. */
export function venueAdminBase(venueId: string): string {
  return `/bares/${encodeURIComponent(venueId)}`;
}

function NotAllowed() {
  return <EmptyState title={t('Você não administra este local')}>{t('Peça ao responsável pelo local para convidar você para a equipe.')}</EmptyState>;
}

/** Como as pessoas veem a página do local: a mesma capa, informações e próximos eventos, só para olhar. */
function PublicPreview({ venue, now }: { venue: VenueProfile; now: Date }) {
  return (
    <div className="vpreview">
      <Notice>{t('É assim que as pessoas veem a página de {name}. Aqui você só olha.', { name: venue.name })}</Notice>
      <div className="vpreview__page" aria-label={t('Prévia da página')}>
        <VenueHero venue={venue} now={now} onShare={() => undefined} preview />
        <div className="vhead">
          <div className="vhead__actions">
            <Button variant="primary" disabled>
              {t('Seguir')}
            </Button>
            <Button variant="secondary" disabled>
              {t('Rota')}
            </Button>
          </div>
          <p className="muted">{venue.followerCount === 1 ? t('1 pessoa segue esta página') : t('{count} pessoas seguem esta página', { count: venue.followerCount })}</p>
        </div>
        {venue.description ? <p className="vabout__text">{venue.description}</p> : <p className="muted">{t('Sem descrição ainda. Toque em Editar perfil para contar o que as pessoas encontram aí.')}</p>}
        <div className="vinfolist">
          <HoursInfo venue={venue} now={now} />
          {venue.address ? (
            <InfoRow icon={<LocationIcon />}>
              <span className="vinfo__addr">{venue.address}</span>
            </InfoRow>
          ) : (
            <InfoRow icon={<LocationIcon />}>
              <span className="muted">{t('Sem endereço ainda.')}</span>
            </InfoRow>
          )}
        </div>
        <h2 className="section__title">{t('Próximos eventos')}</h2>
        {venue.upcomingEvents.length === 0 ? (
          <p className="muted">{t('Nenhum evento marcado. Quando o rolê divulgar eventos, eles aparecem aqui.')}</p>
        ) : (
          <ul className="vagenda" aria-label={t('Próximos eventos')}>
            {venue.upcomingEvents.map((e) => (
              <AgendaRow key={e.id} event={e} now={now} preview />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Painel: resumo do local e atalhos do dia a dia. */
export function VenueAdminHomeScreen({ venueId }: { venueId: string }) {
  const page = useAsync(() => api.venueProfile(venueId), [venueId]);
  const v = page.data;
  useTitle(v ? t('Painel · {name}', { name: v.name }) : t('Painel'));
  const [sheet, setSheet] = useState<'edit' | 'event' | 'post' | 'qr' | 'story' | undefined>();
  const [done, setDone] = useState<string | undefined>();
  const [view, setView] = useState<'manage' | 'public'>('manage');
  const now = new Date();

  if (page.loading && !v) return <Loading />;
  if (!v) return <ErrorState message={page.error?.message ?? t('Não foi possível abrir o painel.')} onRetry={page.reload} />;
  if (!v.canManage) return <NotAllowed />;
  const next = v.upcomingEvents[0];

  return (
    <>
      <PageHead title={t('Painel')} subtitle={v.name} />
      <div className="segtabs segtabs--fill" role="tablist" aria-label={t('Visão do painel')}>
        <button type="button" role="tab" aria-selected={view === 'manage'} className="segtabs__tab" onClick={() => setView('manage')}>
          {t('Gerenciar')}
        </button>
        <button type="button" role="tab" aria-selected={view === 'public'} className="segtabs__tab" onClick={() => setView('public')}>
          {t('Como as pessoas veem')}
        </button>
      </div>
      {view === 'public' ? <PublicPreview venue={v} now={now} /> : null}
      {view === 'manage' ? (
        <>
      <section className="vadmin__hero" aria-label={t('Resumo do local')}>
        <VenueLogo name={v.name} logoUrl={v.logoUrl} size={56} />
        <div className="vadmin__who">
          <strong className="vadmin__name">{v.name}</strong>
          <span className="vadmin__role">{v.role === 'OWNER' ? t('Você é o responsável') : t('Você é administrador')}</span>
        </div>
      </section>
      <ul className="vadmin__stats" aria-label={t('Números do local')}>
        <li className="vadmin__stat">
          <strong>{v.followerCount}</strong>
          <span>{v.followerCount === 1 ? t('seguidor') : t('seguidores')}</span>
        </li>
        <li className="vadmin__stat">
          <strong>{v.rating.average === null ? '–' : formatRating(v.rating.average)}</strong>
          <span>{v.rating.count === 1 ? t('1 avaliação') : t('{count} avaliações', { count: v.rating.count })}</span>
        </li>
        <li className="vadmin__stat">
          <strong>{v.upcomingEvents.length}</strong>
          <span>{v.upcomingEvents.length === 1 ? t('evento próximo') : t('eventos próximos')}</span>
        </li>
      </ul>
      {done ? <Notice tone="ok">{done}</Notice> : null}
      <div className="vadmin__actions">
        <Button full onClick={() => setSheet('event')}>
          {t('Novo evento')}
        </Button>
        <Button full variant="secondary" onClick={() => setSheet('post')}>
          {t('Novo post')}
        </Button>
        <Button full variant="secondary" onClick={() => setSheet('story')}>
          {t('Novo story')}
        </Button>
        <Button full variant="secondary" onClick={() => setSheet('edit')}>
          {t('Editar perfil')}
        </Button>
        <Button full variant="secondary" onClick={() => setSheet('qr')}>
          {t('QR code')}
        </Button>
        <Button full variant="secondary" onClick={() => navigate(`/bares/${encodeURIComponent(v.id)}/oferta`)}>
          {t('Oferta relâmpago')}
        </Button>
      </div>
      <section className="section" aria-labelledby="vadmin-next">
        <h2 id="vadmin-next" className="section__title">
          {t('Próximo evento')}
        </h2>
        {next ? (
          <p className="vadmin__next">
            <strong>{next.title}</strong>
            <span className="muted">{formatWhen(next.startsAt, next.endsAt, now)}</span>
          </p>
        ) : (
          <p className="muted">{t('Nenhum evento marcado. Crie o primeiro em Novo evento.')}</p>
        )}
      </section>
        </>
      ) : null}
      {sheet === 'story' ? <VenueStorySheet venueId={v.id} onClose={() => setSheet(undefined)} /> : null}
      {sheet === 'qr' ? <CheckinQrSheet venueId={v.id} venueName={v.name} onClose={() => setSheet(undefined)} /> : null}
      {sheet === 'edit' ? (
        <ProfileEditSheet
          venue={v}
          onClose={() => setSheet(undefined)}
          onSaved={() => {
            setSheet(undefined);
            setDone(t('Perfil atualizado.'));
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
            setDone(t('Evento criado.'));
            page.reload();
          }}
        />
      ) : null}
      {sheet === 'post' ? (
        <VenuePostSheet
          venueId={v.id}
          onClose={() => setSheet(undefined)}
          onSaved={() => {
            setSheet(undefined);
            setDone(t('Post publicado.'));
          }}
        />
      ) : null}
    </>
  );
}

/** Eventos do local: todos, com criar, editar, apagar e chapelaria. */
export function VenueAdminEventsScreen({ venueId }: { venueId: string }) {
  useTitle(t('Eventos'));
  const page = useAsync(() => api.venueProfile(venueId), [venueId]);
  const [sheet, setSheet] = useState(false);
  const [editing, setEditing] = useState<VenueEvent | undefined>();
  const [key, setKey] = useState(0);
  const now = new Date();
  const v = page.data;
  if (page.loading && !v) return <Loading />;
  if (!v) return <ErrorState message={page.error?.message ?? t('Não foi possível abrir os eventos.')} onRetry={page.reload} />;
  if (!v.canManage) return <NotAllowed />;
  return (
    <>
      <PageHead title={t('Eventos')} subtitle={v.name} />
      <OwnerEvents venueId={v.id} now={now} reloadKey={key} onNew={() => setSheet(true)} onEdit={(e) => setEditing(e)} onChanged={page.reload} />
      {sheet || editing ? (
        <VenueEventSheet
          venueId={v.id}
          {...(editing ? { event: editing } : {})}
          onClose={() => {
            setSheet(false);
            setEditing(undefined);
          }}
          onSaved={() => {
            setSheet(false);
            setEditing(undefined);
            setKey((k) => k + 1);
            page.reload();
          }}
        />
      ) : null}
    </>
  );
}

function MemberRow({ member, canRemove, onRemove }: { member: TeamMember; canRemove: boolean; onRemove: () => void }) {
  return (
    <li className="vteam__row">
      <span className="vteam__who">
        <Avatar profile={member.user} size={40} />
        <span className="vteam__name">
          <strong>{member.user.displayName || member.user.username}</strong>
          <span className="muted">@{member.user.username}</span>
        </span>
      </span>
      <span className={`vteam__badge${member.status === 'PENDING' ? ' vteam__badge--pending' : ''}`}>{member.role === 'OWNER' ? t('Responsável') : member.status === 'PENDING' ? t('Convite enviado') : t('Administrador')}</span>
      {canRemove ? (
        <Button small variant="quiet" onClick={onRemove}>
          {member.status === 'PENDING' ? t('Cancelar convite') : t('Remover')}
        </Button>
      ) : null}
    </li>
  );
}

/** Equipe: o responsável convida e remove; o administrador adicional só vê e pode sair. */
export function VenueTeamScreen({ venueId }: { venueId: string }) {
  useTitle(t('Equipe'));
  const team = useAsync(() => api.venueTeam(venueId), [venueId]);
  const profile = useAsync(() => api.venueProfile(venueId), [venueId]);
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [note, setNote] = useState<string | undefined>();
  const [removing, setRemoving] = useState<TeamMember | undefined>();
  const [leaving, setLeaving] = useState(false);

  if (team.loading && !team.data) return <Loading />;
  if (!team.data) return <ErrorState message={team.error?.message ?? t('Não foi possível abrir a equipe.')} onRetry={team.reload} />;
  const owner = team.data.role === 'OWNER';
  const name = profile.data?.name;

  async function invite() {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    setNote(undefined);
    try {
      await api.inviteVenueManager(venueId, username);
      setNote(t('Convite enviado. A pessoa vira administradora quando aceitar.'));
      setUsername('');
      team.reload();
    } catch (failure) {
      setError(toApiError(failure).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(member: TeamMember) {
    setBusy(true);
    setError(undefined);
    try {
      await api.removeVenueManager(venueId, member.user.userId);
      setRemoving(undefined);
      team.reload();
    } catch (failure) {
      setError(toApiError(failure).message);
      setRemoving(undefined);
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    setBusy(true);
    try {
      await api.leaveVenueTeam(venueId);
      navigate('/locais', { replace: true });
    } catch (failure) {
      setError(toApiError(failure).message);
      setLeaving(false);
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead title={t('Equipe')} {...(name ? { subtitle: name } : {})} />
      <p className="muted vteam__intro">{owner ? t('Quem você convidar edita o perfil, os eventos, a agenda, os posts e a chapelaria. Só você mexe na equipe e no impulsionamento.') : t('Você edita o perfil, os eventos, a agenda, os posts e a chapelaria. Só o responsável mexe na equipe e no impulsionamento.')}</p>
      <ul className="vteam__list" aria-label={t('Pessoas da equipe')}>
        {team.data.members.map((m) => (
          <MemberRow key={m.user.userId} member={m} canRemove={owner && m.role === 'MANAGER'} onRemove={() => setRemoving(m)} />
        ))}
      </ul>
      {owner ? (
        <section className="vteam__invite" aria-labelledby="vteam-invite">
          <h2 id="vteam-invite" className="section__title">
            {t('Convidar pessoa')}
          </h2>
          <Field label={t('@usuário')} value={username} onChange={setUsername} autoComplete="off" maxLength={40} hint={t('A pessoa recebe um aviso e só entra na equipe se aceitar.')} />
          <Button full loading={busy} disabled={username.trim() === ''} onClick={() => invite()}>
            {t('Enviar convite')}
          </Button>
        </section>
      ) : (
        <Button full variant="secondary" onClick={() => setLeaving(true)}>
          {t('Sair da equipe')}
        </Button>
      )}
      {note ? <Notice tone="ok">{note}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {removing ? <Confirm question={removing.status === 'PENDING' ? t('Cancelar o convite para @{username}?', { username: removing.user.username }) : t('Tirar @{username} da equipe? Ela deixa de administrar o local.', { username: removing.user.username })} confirmLabel={removing.status === 'PENDING' ? t('Cancelar convite') : t('Remover')} danger busy={busy} onConfirm={() => void remove(removing)} onCancel={() => setRemoving(undefined)} /> : null}
      {leaving ? <Confirm question={t('Sair da equipe? Você deixa de administrar este local.')} confirmLabel={t('Sair')} danger busy={busy} onConfirm={() => void leave()} onCancel={() => setLeaving(false)} /> : null}
    </>
  );
}
