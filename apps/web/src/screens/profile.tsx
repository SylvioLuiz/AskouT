import { useEffect, useState } from 'react';
import { LockIcon } from '../components/icons.tsx';
import { ChatButton } from '../components/chat-button.tsx';
import { Avatar, Button, Confirm, EmptyState, ErrorState, Loading, Notice, PageHead, PersonRow } from '../components/ui.tsx';
import { api } from '../client.ts';
import { useAsync, useTitle } from '../hooks.ts';
import { toApiError } from '../lib/errors.ts';
import type { ApiError } from '../lib/errors.ts';
import { formatCount, pluralize } from '../lib/format.ts';
import { hasIncomingRequest, profileAction, relationNote } from '../lib/relations.ts';
import type { ConnectionsPage } from '../lib/types.ts';
import { Link } from '../router.tsx';

type Pending = 'unfollow' | 'block' | undefined;

function NotFoundProfile({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
  if (error.code === 'NOT_FOUND') {
    return (
      <EmptyState
        title="Perfil não encontrado"
        action={
          <Link to="/explorar" className="btn btn--secondary">
            Buscar pessoas
          </Link>
        }
      >
        Esse @usuário não existe ou não está disponível para você.
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

  useEffect(() => {
    setMessage(undefined);
    setPending(undefined);
  }, [username]);

  async function run(action: () => Promise<unknown>, success?: string) {
    setBusy(true);
    setMessage(undefined);
    try {
      await action();
      if (success) setMessage({ tone: 'ok', text: success });
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
      <header className="profile">
        <Avatar profile={profile} size={88} />
        <div className="profile__id">
          <h1 className="profile__name">
            {profile.displayName}
            {profile.isPrivate ? (
              <span className="profile__lock" title="Perfil privado">
                <LockIcon />
                <span className="visually-hidden">Perfil privado</span>
              </span>
            ) : null}
          </h1>
          <p className="profile__handle">@{profile.username}</p>
          {note ? <p className="profile__note">{note}</p> : null}
        </div>
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
        </p>
      ) : null}

      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

      {hasIncomingRequest(relationship) ? (
        <div className="callout">
          <p className="callout__text">
            <strong>@{profile.username}</strong> pediu para seguir você.
          </p>
          <div className="row-actions">
            <Button small loading={busy} onClick={() => run(() => api.approveRequest(profile.userId), 'Pedido aprovado.')}>
              Aprovar
            </Button>
            <Button small variant="secondary" disabled={busy} onClick={() => run(() => api.rejectRequest(profile.userId), 'Pedido recusado.')}>
              Recusar
            </Button>
          </div>
        </div>
      ) : null}

      <div className="profile__actions">
        {action.kind === 'self' ? (
          <Link to="/perfil" className="btn btn--secondary">
            Editar perfil
          </Link>
        ) : null}
        {action.kind === 'follow' ? (
          <Button loading={busy} onClick={() => run(() => api.follow(profile.userId))}>
            {action.label}
          </Button>
        ) : null}
        {action.kind === 'requested' ? (
          <Button variant="secondary" loading={busy} onClick={() => run(() => api.unfollow(profile.userId), 'Pedido cancelado.')}>
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
          <Button variant="secondary" loading={busy} onClick={() => run(() => api.unblock(profile.userId), `Você desbloqueou @${profile.username}.`)}>
            Desbloquear
          </Button>
        ) : null}
        {action.kind !== 'self' && action.kind !== 'blocked' ? (
          <Button variant="quiet" disabled={busy} onClick={() => setPending(pending === 'block' ? undefined : 'block')} aria-expanded={pending === 'block'}>
            Bloquear
          </Button>
        ) : null}
      </div>

      {pending === 'unfollow' ? (
        <Confirm
          question={relationship.isFriend ? `Deixar de seguir @${profile.username}? Vocês deixam de ser amigos.` : `Deixar de seguir @${profile.username}?`}
          confirmLabel="Deixar de seguir"
          busy={busy}
          onCancel={() => setPending(undefined)}
          onConfirm={() => run(() => api.unfollow(profile.userId), `Você deixou de seguir @${profile.username}.`)}
        />
      ) : null}
      {pending === 'block' ? (
        <Confirm
          danger
          question={`Bloquear @${profile.username}? Essa pessoa deixa de ver seu perfil e vocês param de se seguir.`}
          confirmLabel="Bloquear"
          busy={busy}
          onCancel={() => setPending(undefined)}
          onConfirm={() => run(() => api.block(profile.userId), `Você bloqueou @${profile.username}.`)}
        />
      ) : null}

      {relationship.blockedByViewer ? (
        <EmptyState title={`Você bloqueou @${profile.username}`}>Desbloqueie para ver o perfil de novo ou seguir.</EmptyState>
      ) : !canViewContent ? (
        <EmptyState title="Este perfil é privado">
          {relationship.following === 'PENDING' ? 'Seu pedido foi enviado. Você vê o conteúdo quando @' + profile.username + ' aprovar.' : 'Peça para seguir e aguarde a aprovação para ver o conteúdo.'}
        </EmptyState>
      ) : (
        <>
          {relationship.isFriend ? (
            <Link to={`/u/${encodeURIComponent(profile.username)}/agenda`} className="callout callout--link">
              <span className="callout__text">
                <strong>Ver agenda de {profile.displayName}</strong>
                <br />
                Veja os horários e compare com os seus.
              </span>
            </Link>
          ) : relationship.isSelf ? null : (
            <p className="muted profile__soon">A agenda é visível só para amigos, quando vocês se seguem.</p>
          )}
          <p className="muted profile__soon">Publicações deste perfil chegam nas próximas etapas.</p>
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
  useTitle(`${title} de @${username}`);

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
          <EmptyState title="Você não pode ver esta lista">Só quem segue este perfil privado, com aprovação, vê as conexões.</EmptyState>
        ) : (
          <ErrorState message={error.message} onRetry={() => void load(page?.items.length ?? 0)} />
        )
      ) : null}
      {!page && loading ? <Loading /> : null}
      {page && page.items.length === 0 ? <EmptyState title={direction === 'followers' ? 'Ninguém segue este perfil ainda' : 'Não segue ninguém ainda'} /> : null}
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
                Carregar mais
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
    </>
  );
}

