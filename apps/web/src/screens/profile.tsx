import { useEffect, useState } from 'react';
import { EditIcon, LockIcon, MenuIcon } from '../components/icons.tsx';
import { ProfileActions } from '../components/profile-actions.tsx';
import { ProfileMenu } from '../components/profile-menu.tsx';
import { PostedEvents } from '../components/profile-events.tsx';
import { PostGrid } from '../components/post.tsx';
import { ChatButton } from '../components/chat-button.tsx';
import { Avatar, Button, Confirm, EmptyState, ErrorState, Loading, Notice, PageHead, PersonRow } from '../components/ui.tsx';
import { api } from '../client.ts';
import { useAsync, useTitle } from '../hooks.ts';
import { toApiError } from '../lib/errors.ts';
import type { ApiError } from '../lib/errors.ts';
import { formatCount, pluralize } from '../lib/format.ts';
import { hasIncomingRequest, profileAction, relationNote } from '../lib/relations.ts';
import type { ConnectionsPage } from '../lib/types.ts';
import { FOLLOW_HINT, safeStorage, takeFirstFollowHint } from '../lib/hints.ts';
import { Link, useSearch } from '../router.tsx';
import { t } from '../lib/i18n/index.ts';

type Pending = 'unfollow' | undefined;

function NotFoundProfile({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
  if (error.code === 'NOT_FOUND') {
    return (
      <EmptyState
        title={t('Perfil não encontrado')}
        action={
          <Link to="/explorar" className="btn btn--secondary">
            {t('Buscar pessoas')}
          </Link>
        }
      >
        {t('Esse @usuário não existe ou não está disponível para você.')}
      </EmptyState>
    );
  }
  return <ErrorState message={error.message} onRetry={onRetry} />;
}

export function ProfileScreen({ username }: { username: string }) {
  const view = useAsync(() => api.getProfile(username), [username]);
  const data = view.data;
  useTitle(data ? data.profile.displayName : 'Perfil');

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | undefined>();
  const [pending, setPending] = useState<Pending>(undefined);
  const [menuOpen, setMenuOpen] = useState(false);
  const search = useSearch();
  const [tab, setTab] = useState<'events' | 'posts'>(search.get('aba') === 'posts' ? 'posts' : 'events');
  const [eventTotal, setEventTotal] = useState<number | undefined>();

  useEffect(() => {
    setMessage(undefined);
    setPending(undefined);
    setMenuOpen(false);
    setTab('events');
    setEventTotal(undefined);
  }, [username]);

  async function run<R>(action: () => Promise<R>, success?: string | ((result: R) => string | undefined)) {
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await action();
      const text = typeof success === 'function' ? success(result) : success;
      if (text) setMessage({ tone: 'ok', text });
      setPending(undefined);
      view.reload();
    } catch (failure) {
      setMessage({ tone: 'error', text: toApiError(failure).message });
    } finally {
      setBusy(false);
    }
  }

  if (view.loading && !data) return <Loading />;
  if (view.error && !data) return <NotFoundProfile error={view.error} onRetry={view.reload} />;
  if (!data) return null;

  const { profile, counts, relationship, canViewContent } = data;
  const action = profileAction(relationship);
  const note = relationNote(relationship);
  const base = `/u/${encodeURIComponent(profile.username)}`;

  return (
    <>
      {relationship.isSelf ? (
        <div className="profile__bar">
          <span className="profile__barname">@{profile.username}</span>
          <button type="button" className="iconbtn" onClick={() => setMenuOpen(true)} aria-label={t('Abrir menu')} aria-haspopup="dialog">
            <MenuIcon />
          </button>
        </div>
      ) : null}
      {menuOpen ? <ProfileMenu onClose={() => setMenuOpen(false)} /> : null}
      <header className="profile">
        <Avatar profile={profile} size={88} />
        <div className="profile__id">
          <h1 className="profile__name">
            {profile.displayName}
            {profile.isPrivate ? (
              <span className="profile__lock" title={t('Perfil privado')}>
                <LockIcon />
                <span className="visually-hidden">{t('Perfil privado')}</span>
              </span>
            ) : null}
          </h1>
          <p className="profile__handle">@{profile.username}</p>
          {note ? <p className="profile__note">{note}</p> : null}
        </div>
        {relationship.isSelf ? (
          <Link to="/perfil/editar" className="iconbtn profile__edit" aria-label={t('Editar perfil')}>
            <EditIcon />
          </Link>
        ) : !relationship.isSelf ? (
          <ProfileActions
            profile={profile}
            relationship={relationship}
            onChanged={(notice) => {
              setMessage({ tone: 'ok', text: notice });
              view.reload();
            }}
          />
        ) : null}
      </header>

      {profile.bio ? <p className="profile__bio">{profile.bio}</p> : null}

      {!relationship.blockedByViewer ? (
        <p className="profile__counts">
          {canViewContent ? (
            <>
              <Link to={`${base}/seguidores`}>
                <strong>{formatCount(counts.followers)}</strong> {counts.followers === 1 ? 'seguidor' : 'seguidores'}
              </Link>
              <Link to={`${base}/seguindo`}>
                <strong>{formatCount(counts.following)}</strong> seguindo
              </Link>
            </>
          ) : (
            <>
              <span>
                <strong>{formatCount(counts.followers)}</strong> {counts.followers === 1 ? 'seguidor' : 'seguidores'}
              </span>
              <span>
                <strong>{formatCount(counts.following)}</strong> seguindo
              </span>
            </>
          )}
          <span>
            <strong>{formatCount(eventTotal ?? counts.events)}</strong> {(eventTotal ?? counts.events) === 1 ? 'evento' : 'eventos'}
          </span>
        </p>
      ) : null}

      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

      {hasIncomingRequest(relationship) ? (
        <div className="callout">
          <p className="callout__text">
            <strong>@{profile.username}</strong> pediu para seguir você.
          </p>
          <div className="row-actions">
            <Button small loading={busy} onClick={() => run(() => api.approveRequest(profile.userId), t('Pedido aprovado.'))}>
              {t('Aprovar')}
            </Button>
            <Button small variant="secondary" disabled={busy} onClick={() => run(() => api.rejectRequest(profile.userId), t('Pedido recusado.'))}>
              {t('Recusar')}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="profile__actions">
        {action.kind === 'follow' ? (
          <Button loading={busy} onClick={() => run(() => api.follow(profile.userId), (r) => (!r.isFriend && takeFirstFollowHint(safeStorage()) ? FOLLOW_HINT : undefined))}>
            {action.label}
          </Button>
        ) : null}
        {action.kind === 'requested' ? (
          <Button variant="secondary" loading={busy} onClick={() => run(() => api.unfollow(profile.userId), t('Pedido cancelado.'))}>
            {action.label}
          </Button>
        ) : null}
        {action.kind === 'following' ? (
          <Button variant="secondary" disabled={busy} onClick={() => setPending(pending === 'unfollow' ? undefined : 'unfollow')} aria-expanded={pending === 'unfollow'}>
            {action.label}
          </Button>
        ) : null}
        {relationship.isFriend && !relationship.isSelf && action.kind !== 'blocked' ? <ChatButton userId={profile.userId} variant="primary" /> : null}
        {action.kind === 'blocked' ? (
          <Button variant="secondary" loading={busy} onClick={() => run(() => api.unblock(profile.userId), t('Você desbloqueou @{username}.', { username: profile.username }))}>
            {t('Desbloquear')}
          </Button>
        ) : null}
      </div>

      {pending === 'unfollow' ? (
        <Confirm
          question={relationship.isFriend ? t('Deixar de seguir @{username}? Vocês deixam de ser amigos.', { username: profile.username }) : t('Deixar de seguir @{username}?', { username: profile.username })}
          confirmLabel={t('Deixar de seguir')}
          busy={busy}
          onCancel={() => setPending(undefined)}
          onConfirm={() => run(() => api.unfollow(profile.userId), t('Você deixou de seguir @{username}.', { username: profile.username }))}
        />
      ) : null}

      {relationship.blockedByViewer ? (
        <EmptyState title={t('Você bloqueou @{username}', { username: profile.username })}>{t('Desbloqueie para ver o perfil de novo ou seguir.')}</EmptyState>
      ) : !canViewContent ? (
        <EmptyState title={t('Este perfil é privado')}>
          {relationship.following === 'PENDING' ? t('Seu pedido foi enviado. Você vê o conteúdo quando @') + profile.username + ' aprovar.' : t('Peça para seguir e aguarde a aprovação para ver o conteúdo.')}
        </EmptyState>
      ) : (
        <>
          <div className="tabs" role="tablist" aria-label={t('Conteúdo do perfil')}>
            <button type="button" role="tab" id="aba-eventos" aria-selected={tab === 'events'} aria-controls="painel-perfil" className={`tabs__tab${tab === 'events' ? ' tabs__tab--on' : ''}`} onClick={() => setTab('events')}>
              {t('Eventos')}
            </button>
            <button type="button" role="tab" id="aba-posts" aria-selected={tab === 'posts'} aria-controls="painel-perfil" className={`tabs__tab${tab === 'posts' ? ' tabs__tab--on' : ''}`} onClick={() => setTab('posts')}>
              {t('Posts')}
            </button>
          </div>
          <div id="painel-perfil" role="tabpanel" aria-labelledby={tab === 'events' ? 'aba-eventos' : 'aba-posts'}>
            {tab === 'events' ? (
              <PostedEvents username={profile.username} mine={relationship.isSelf} onCount={setEventTotal} />
            ) : (
              <PostGrid username={profile.username} kind="post" />
            )}
          </div>
        </>
      )}
    </>
  );
}

const PAGE_SIZE = 30;

export function ConnectionsScreen({ username, direction }: { username: string; direction: 'followers' | 'following' }) {
  const view = useAsync(() => api.getProfile(username), [username]);
  const [page, setPage] = useState<ConnectionsPage | undefined>();
  const [error, setError] = useState<ApiError | undefined>();
  const [loading, setLoading] = useState(false);

  const userId = view.data?.profile.userId;
  const title = direction === 'followers' ? 'Seguidores' : 'Seguindo';
  useTitle(t('{title} de @{username}', { title, username }));

  async function load(offset: number) {
    if (!userId) return;
    setLoading(true);
    setError(undefined);
    try {
      const fetcher = direction === 'followers' ? api.followers : api.following;
      const next = await fetcher(userId, { limit: PAGE_SIZE, offset });
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
  }, [userId, direction]);

  const back = `/u/${encodeURIComponent(username)}`;
  if (view.loading && !view.data) return <Loading />;
  if (view.error) return <NotFoundProfile error={view.error} onRetry={view.reload} />;

  const hasMore = page ? page.items.length < page.total && page.items.length > 0 : false;

  return (
    <>
      <PageHead title={title} back={back} subtitle={`@${username}`} />
      {error ? (
        error.code === 'FORBIDDEN' || error.code === 'NOT_FOUND' ? (
          <EmptyState title={t('Você não pode ver esta lista')}>{t('Só quem segue este perfil privado, com aprovação, vê as conexões.')}</EmptyState>
        ) : (
          <ErrorState message={error.message} onRetry={() => void load(page?.items.length ?? 0)} />
        )
      ) : null}
      {!page && loading ? <Loading /> : null}
      {page && page.items.length === 0 ? <EmptyState title={direction === 'followers' ? t('Ninguém segue este perfil ainda') : t('Não segue ninguém ainda')} /> : null}
      {page && page.items.length > 0 ? (
        <>
          <p className="muted">{pluralize(page.total, direction === 'followers' ? 'seguidor' : 'pessoa', direction === 'followers' ? 'seguidores' : 'pessoas')}</p>
          <ul className="list">
            {page.items.map((profile) => (
              <PersonRow key={profile.userId} profile={profile} />
            ))}
          </ul>
          {hasMore ? (
            <div className="more">
              <Button variant="secondary" loading={loading} onClick={() => void load(page.items.length)}>
                {t('Carregar mais')}
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
    </>
  );
}

