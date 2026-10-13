import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Avatar, Button, EmptyState, ErrorState, Field, Loading, Notice, PageHead, PersonRow } from '../components/ui.tsx';
import { api } from '../client.ts';
import { useAuthContext, useUser } from '../auth.tsx';
import { useAsync, useTitle } from '../hooks.ts';
import { toApiError } from '../lib/errors.ts';
import { pluralize } from '../lib/format.ts';
import {
  avatarUrlProblem,
  BIO_MAX,
  bioProblem,
  compact,
  displayNameProblem,
} from '../lib/validation.ts';
import { Link } from '../router.tsx';

export function MyProfileScreen() {
  useTitle('Seu perfil');
  const user = useUser();
  const { setOwnProfile, signOut } = useAuthContext();
  const view = useAsync(() => api.getProfile(user.profile.username), [user.profile.username]);

  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | undefined>();
  const [saving, setSaving] = useState(false);
  const [privacyBusy, setPrivacyBusy] = useState(false);
  const [isPrivate, setIsPrivate] = useState(user.profile.isPrivate);

  const loaded = view.data;
  useEffect(() => {
    if (!loaded) return;
    setDisplayName(loaded.profile.displayName);
    setBio(loaded.profile.bio ?? '');
    setAvatarUrl(loaded.profile.avatarUrl ?? '');
    setIsPrivate(loaded.profile.isPrivate);
  }, [loaded]);

  async function save(event: FormEvent) {
    event.preventDefault();
    const found = compact({
      displayName: displayNameProblem(displayName, true),
      bio: bioProblem(bio),
      avatarUrl: avatarUrlProblem(avatarUrl),
    });
    setErrors(found);
    setMessage(undefined);
    if (Object.keys(found).length > 0) return;

    setSaving(true);
    try {
      const updated = await api.updateProfile({ displayName: displayName.trim(), bio: bio.trim(), avatarUrl: avatarUrl.trim() });
      setOwnProfile({
        userId: updated.userId,
        username: updated.username,
        displayName: updated.displayName,
        avatarUrl: updated.avatarUrl,
        isPrivate: updated.isPrivate,
      });
      setMessage({ tone: 'ok', text: 'Perfil atualizado.' });
    } catch (failure) {
      const error = toApiError(failure);
      setErrors(error.fields);
      setMessage(Object.keys(error.fields).length === 0 ? { tone: 'error', text: error.message } : undefined);
    } finally {
      setSaving(false);
    }
  }

  async function togglePrivacy() {
    setPrivacyBusy(true);
    setMessage(undefined);
    try {
      const next = !isPrivate;
      const result = await api.setPrivacy(next);
      setIsPrivate(result.isPrivate);
      setOwnProfile({ ...user.profile, isPrivate: result.isPrivate });
      setMessage({
        tone: 'ok',
        text: result.isPrivate
          ? 'Seu perfil agora é privado. Quem já segue continua seguindo; novos seguidores precisam da sua aprovação.'
          : result.acceptedPending > 0
            ? `Seu perfil agora é público. ${pluralize(result.acceptedPending, 'pedido pendente foi aceito', 'pedidos pendentes foram aceitos')}.`
            : 'Seu perfil agora é público.',
      });
    } catch (failure) {
      setMessage({ tone: 'error', text: toApiError(failure).message });
    } finally {
      setPrivacyBusy(false);
    }
  }

  if (view.loading && !loaded) return <Loading />;
  if (view.error && !loaded) return <ErrorState message={view.error.message} onRetry={view.reload} />;

  return (
    <>
      <PageHead title="Seu perfil" />
      <div className="profile profile--compact">
        <Avatar profile={{ username: user.profile.username, displayName: displayName || user.profile.displayName, avatarUrl: avatarUrl.trim() !== '' && !avatarUrlProblem(avatarUrl) ? avatarUrl.trim() : null }} size={72} />
        <div className="profile__id">
          <p className="profile__name profile__name--sm">@{user.profile.username}</p>
          <p className="profile__note">{user.email}</p>
        </div>
      </div>

      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

      <form className="form form--flat" onSubmit={save} noValidate>
        <Field label="Nome" value={displayName} onChange={setDisplayName} error={errors['displayName']} maxLength={60} autoComplete="name" />
        <Field label="Sobre você" value={bio} onChange={setBio} error={errors['bio']} hint={`${Array.from(bio).length}/${BIO_MAX}`} multiline maxLength={BIO_MAX + 20} />
        <Field label="Endereço da foto" value={avatarUrl} onChange={setAvatarUrl} error={errors['avatarUrl']} hint="Opcional. Um link https para uma imagem." autoComplete="off" />
        <div>
          <Button type="submit" loading={saving}>
            Salvar alterações
          </Button>
        </div>
      </form>

      <section className="setting">
        <div className="setting__text">
          <h2 className="setting__title" id="privado-titulo">
            Perfil privado
          </h2>
          <p className="setting__help">Com o perfil privado, só quem você aprova vê seu conteúdo e suas conexões.</p>
        </div>
        <button type="button" role="switch" aria-checked={isPrivate} aria-labelledby="privado-titulo" className="switch" onClick={togglePrivacy} disabled={privacyBusy}>
          <span className="switch__thumb" />
        </button>
      </section>

      <nav className="linklist" aria-label="Sua conta">
        <Link to={`/u/${encodeURIComponent(user.profile.username)}`}>Ver como os outros veem</Link>
        <Link to="/amigos">Amigos</Link>
        <Link to="/atividades">Pedidos para seguir</Link>
        <Link to="/bloqueados">Pessoas bloqueadas</Link>
      </nav>

      <div className="signout">
        <Button variant="secondary" onClick={signOut}>
          Sair
        </Button>
      </div>
    </>
  );
}

export function FriendsScreen() {
  useTitle('Amigos');
  const friends = useAsync(() => api.friends(), []);
  return (
    <>
      <PageHead title="Amigos" back="/perfil" subtitle="Pessoas que seguem você e que você segue" />
      {friends.loading && !friends.data ? <Loading /> : null}
      {friends.error ? <ErrorState message={friends.error.message} onRetry={friends.reload} /> : null}
      {friends.data && friends.data.length === 0 ? (
        <EmptyState
          title="Nenhum amigo ainda"
          action={
            <Link to="/explorar" className="btn btn--primary">
              Encontrar pessoas
            </Link>
          }
        >
          Você e outra pessoa viram amigos quando se seguem.
        </EmptyState>
      ) : null}
      {friends.data && friends.data.length > 0 ? (
        <>
          <p className="muted">{pluralize(friends.data.length, 'amigo', 'amigos')}</p>
          <ul className="list">
            {friends.data.map((friend) => (
              <PersonRow key={friend.userId} profile={friend} />
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}

export function BlockedScreen() {
  useTitle('Pessoas bloqueadas');
  const blocked = useAsync(() => api.blocks(), []);
  const [busyId, setBusyId] = useState<string | undefined>();
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | undefined>();

  async function unblock(userId: string, username: string) {
    setBusyId(userId);
    setMessage(undefined);
    try {
      await api.unblock(userId);
      if (blocked.data) blocked.setData(blocked.data.filter((p) => p.userId !== userId));
      setMessage({ tone: 'ok', text: `Você desbloqueou @${username}.` });
    } catch (failure) {
      setMessage({ tone: 'error', text: toApiError(failure).message });
    } finally {
      setBusyId(undefined);
    }
  }

  return (
    <>
      <PageHead title="Pessoas bloqueadas" back="/perfil" />
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {blocked.loading && !blocked.data ? <Loading /> : null}
      {blocked.error ? <ErrorState message={blocked.error.message} onRetry={blocked.reload} /> : null}
      {blocked.data && blocked.data.length === 0 ? <EmptyState title="Você não bloqueou ninguém">Quem você bloquear aparece aqui, e dá para desbloquear quando quiser.</EmptyState> : null}
      {blocked.data && blocked.data.length > 0 ? (
        <ul className="list">
          {blocked.data.map((profile) => (
            <PersonRow
              key={profile.userId}
              profile={profile}
              aside={
                <Button small variant="secondary" loading={busyId === profile.userId} onClick={() => unblock(profile.userId, profile.username)}>
                  Desbloquear
                </Button>
              }
            />
          ))}
        </ul>
      ) : null}
    </>
  );
}
