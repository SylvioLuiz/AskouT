import { useEffect, useState } from 'react';
import { shareOrigin } from '../lib/public-origin.ts';
import { CameraIcon, ChevronDownIcon, EditIcon, LockIcon, MoreIcon, ShareIcon } from '../components/icons.tsx';
import { StoryViewer } from '../components/event-story.tsx';
import { ShareLinkSheet } from '../components/post-actions.tsx';
import { profileLink, profileShareText } from '../lib/share.ts';
import { ProfileActions } from '../components/profile-actions.tsx';
import { ProfileMenu } from '../components/profile-menu.tsx';
import { PostedEvents } from '../components/profile-events.tsx';
import { PostGrid } from '../components/post.tsx';
import { ChatButton } from '../components/chat-button.tsx';
import { PhotoPickerSheet } from '../components/photo-picker.tsx';
import { AvatarViewer } from '../components/photo-viewer.tsx';
import { useAuthContext } from '../auth.tsx';
import { resizeProfilePhoto } from '../lib/image.ts';
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
  const [photoOpen, setPhotoOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const { setOwnProfile } = useAuthContext();
  const search = useSearch();
  const [tab, setTab] = useState<'events' | 'posts'>(search.get('aba') === 'posts' ? 'posts' : 'events');
  const [eventTotal, setEventTotal] = useState<number | undefined>();
  const [storyOpen, setStoryOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  // Stories que a pessoa publicou no perfil para os amigos (os mesmos da faixa da página inicial).
  const stories = useAsync(() => api.profileStories(), [username]);

  useEffect(() => {
    setMessage(undefined);
    setPending(undefined);
    setMenuOpen(false);
    setPhotoOpen(false);
    setTab('events');
    setEventTotal(undefined);
    setStoryOpen(false);
    setShareOpen(false);
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

  async function changePhoto(file: File | null) {
    setPhotoBusy(true);
    setMessage(undefined);
    try {
      const image = file ? await resizeProfilePhoto(file) : null;
      const updated = await api.setProfilePhoto(image);
      setOwnProfile({ userId: updated.userId, username: updated.username, displayName: updated.displayName, avatarUrl: updated.avatarUrl, isPrivate: updated.isPrivate });
      setMessage({ tone: 'ok', text: file ? t('Foto atualizada.') : t('Foto removida.') });
      view.reload();
    } catch (failure) {
      setMessage({ tone: 'error', text: toApiError(failure).message });
    } finally {
      setPhotoBusy(false);
    }
  }

  if (view.loading && !data) return <Loading />;
  if (view.error && !data) return <NotFoundProfile error={view.error} onRetry={view.reload} />;
  if (!data) return null;

  const { profile, counts, relationship, canViewContent } = data;
  const action = profileAction(relationship);
  const note = relationNote(relationship);
  const base = `/u/${encodeURIComponent(profile.username)}`;
  const storyGroup = stories.data?.groups.find((g) => g.author.userId === profile.userId);
  const hasStory = Boolean(storyGroup && storyGroup.items.length > 0 && !relationship.blockedByViewer);
  const storyLabel = relationship.isSelf ? t('Ver o seu story') : t('Ver o story de {username}', { username: profile.username });

  return (
    <>
      {menuOpen ? <ProfileMenu onClose={() => setMenuOpen(false)} /> : null}
      {shareOpen ? <ShareLinkSheet url={profileLink(shareOrigin(), profile.username)} text={profileShareText(profile.username)} onClose={() => setShareOpen(false)} /> : null}
      {storyOpen && storyGroup ? (
        <StoryViewer
          groups={[storyGroup]}
          start={{ group: 0, item: 0 }}
          onClose={() => setStoryOpen(false)}
          onChanged={() => {
            setStoryOpen(false);
            stories.reload();
          }}
        />
      ) : null}
      {photoOpen ? <PhotoPickerSheet hasPhoto={profile.avatarUrl !== null} onPick={(file) => void changePhoto(file)} onRemove={() => void changePhoto(null)} onView={() => setViewOpen(true)} onClose={() => setPhotoOpen(false)} /> : null}
      {viewOpen && profile.avatarUrl ? <AvatarViewer url={profile.avatarUrl} onClose={() => setViewOpen(false)} /> : null}
      <header className="profile">
        {relationship.isSelf ? (
          <div className="avatarbtn__wrap">
            {hasStory ? (
              <button type="button" className="avatarbtn avatarbtn--story" onClick={() => setStoryOpen(true)} aria-label={storyLabel} aria-haspopup="dialog">
                <span className="storyring">
                  <Avatar profile={profile} size={88} />
                </span>
              </button>
            ) : (
              <button type="button" className="avatarbtn" onClick={() => setPhotoOpen(true)} disabled={photoBusy} aria-label={profile.avatarUrl ? t('Trocar foto') : t('Subir foto')} aria-haspopup="dialog" aria-busy={photoBusy}>
                <Avatar profile={profile} size={88} />
              </button>
            )}
            <button type="button" className="avatarbtn__badge" onClick={() => setPhotoOpen(true)} disabled={photoBusy} aria-label={profile.avatarUrl ? t('Trocar foto') : t('Subir foto')} aria-haspopup="dialog">
              <CameraIcon />
            </button>
          </div>
        ) : hasStory ? (
          <button type="button" className="avatarbtn avatarbtn--story" onClick={() => setStoryOpen(true)} aria-label={storyLabel} aria-haspopup="dialog">
            <span className="storyring">
              <Avatar profile={profile} size={88} />
            </span>
          </button>
        ) : profile.avatarUrl ? (
          <button type="button" className="avatarbtn" onClick={() => setViewOpen(true)} aria-label={t('Ver foto de perfil')} aria-haspopup="dialog">
            <Avatar profile={profile} size={88} />
          </button>
        ) : (
          <Avatar profile={profile} size={88} />
        )}
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
          <div className="profile__tools">
            <button type="button" className="iconbtn" onClick={() => setMenuOpen(true)} aria-label={t('Abrir menu')} aria-haspopup="dialog">
              <MoreIcon />
            </button>
            <Link to="/perfil/editar" className="iconbtn" aria-label={t('Editar perfil')}>
              <EditIcon />
            </Link>
          </div>
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
            <strong>@{profile.username}</strong> {t('pediu para seguir você.')}
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

      {!relationship.isSelf ? (
        <div className="profile__actions">
          {action.kind === 'follow' ? (
            <Button small loading={busy} onClick={() => run(() => api.follow(profile.userId), (r) => (!r.isFriend && takeFirstFollowHint(safeStorage()) ? FOLLOW_HINT : undefined))}>
              {action.label}
            </Button>
          ) : null}
          {action.kind === 'requested' ? (
            <Button small variant="secondary" loading={busy} onClick={() => run(() => api.unfollow(profile.userId), t('Pedido cancelado.'))}>
              {action.label}
            </Button>
          ) : null}
          {action.kind === 'following' ? (
            <Button small variant="secondary" disabled={busy} onClick={() => setPending(pending === 'unfollow' ? undefined : 'unfollow')} aria-expanded={pending === 'unfollow'}>
              {action.label}
              <ChevronDownIcon />
            </Button>
          ) : null}
          {relationship.isFriend && action.kind !== 'blocked' ? <ChatButton userId={profile.userId} variant="secondary" small label={t('Mensagem')} onError={(text) => setMessage({ tone: 'error', text })} /> : null}
          {action.kind === 'blocked' ? (
            <Button small variant="secondary" loading={busy} onClick={() => run(() => api.unblock(profile.userId), t('Você desbloqueou @{username}.', { username: profile.username }))}>
              {t('Desbloquear')}
            </Button>
          ) : (
            <button type="button" className="btn btn--secondary btn--small profile__square" onClick={() => setShareOpen(true)} aria-label={t('Compartilhar perfil')} aria-haspopup="dialog">
              <ShareIcon />
            </button>
          )}
        </div>
      ) : null}

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
          {relationship.following === 'PENDING' ? t('Seu pedido foi enviado. Você vê o conteúdo quando @{username} aprovar.', { username: profile.username }) : t('Peça para seguir e aguarde a aprovação para ver o conteúdo.')}
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

