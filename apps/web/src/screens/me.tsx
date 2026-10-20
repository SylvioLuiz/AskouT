import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { Avatar, Button, EmptyState, ErrorState, Field, Loading, Notice, PageHead, PersonRow } from '../components/ui.tsx';
import { MuteCard, PushCard } from '../components/notifications.tsx';
import { api } from '../client.ts';
import { useAuthContext, useUser } from '../auth.tsx';
import { useAsync, useTitle } from '../hooks.ts';
import { formatWhen } from '../lib/chat.ts';
import { readPersonalize, savePersonalize } from '../lib/dwell.ts';
import { toApiError } from '../lib/errors.ts';
import { pluralize } from '../lib/format.ts';
import { resizeProfilePhoto } from '../lib/image.ts';
import { statusLabel } from '../lib/meetup.ts';
import { applyTheme, readTheme, saveTheme, THEME_LABELS } from '../lib/theme.ts';
import type { ThemeChoice } from '../lib/theme.ts';
import { BIO_MAX, bioProblem, compact, displayNameProblem } from '../lib/validation.ts';
import { InviteSheet } from '../components/invite.tsx';
import { supportMailto } from '../lib/help-mailto.ts';
import { Link } from '../router.tsx';

type Message = { tone: 'ok' | 'error'; text: string } | undefined;

export function EditProfileScreen() {
  useTitle('Editar perfil');
  const user = useUser();
  const { setOwnProfile } = useAuthContext();
  const view = useAsync(() => api.getProfile(user.profile.username), [user.profile.username]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<Message>();
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user.profile.avatarUrl);

  const loaded = view.data;
  useEffect(() => {
    if (!loaded) return;
    setDisplayName(loaded.profile.displayName);
    setBio(loaded.profile.bio ?? '');
    setAvatarUrl(loaded.profile.avatarUrl);
  }, [loaded]);

  function remember(updated: { userId: string; username: string; displayName: string; avatarUrl: string | null; isPrivate: boolean }) {
    setOwnProfile({ userId: updated.userId, username: updated.username, displayName: updated.displayName, avatarUrl: updated.avatarUrl, isPrivate: updated.isPrivate });
    setAvatarUrl(updated.avatarUrl);
  }

  async function pickPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setPhotoBusy(true);
    setMessage(undefined);
    try {
      const image = await resizeProfilePhoto(file);
      remember(await api.setProfilePhoto(image));
      setMessage({ tone: 'ok', text: 'Foto atualizada.' });
    } catch (failure) {
      setMessage({ tone: 'error', text: toApiError(failure).message });
    } finally {
      setPhotoBusy(false);
    }
  }

  async function removePhoto() {
    setPhotoBusy(true);
    setMessage(undefined);
    try {
      remember(await api.setProfilePhoto(null));
      setMessage({ tone: 'ok', text: 'Foto removida.' });
    } catch (failure) {
      setMessage({ tone: 'error', text: toApiError(failure).message });
    } finally {
      setPhotoBusy(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const found = compact({ displayName: displayNameProblem(displayName, true), bio: bioProblem(bio) });
    setErrors(found);
    setMessage(undefined);
    if (Object.keys(found).length > 0) return;
    setSaving(true);
    try {
      remember(await api.updateProfile({ displayName: displayName.trim(), bio: bio.trim() }));
      setMessage({ tone: 'ok', text: 'Perfil atualizado.' });
    } catch (failure) {
      const error = toApiError(failure);
      setErrors(error.fields);
      setMessage(Object.keys(error.fields).length === 0 ? { tone: 'error', text: error.message } : undefined);
    } finally {
      setSaving(false);
    }
  }

  if (view.loading && !loaded) return <Loading />;
  if (view.error && !loaded) return <ErrorState message={view.error.message} onRetry={view.reload} />;

  return (
    <>
      <PageHead title="Editar perfil" back="/perfil" />
      <div className="photoedit">
        <Avatar profile={{ userId: user.profile.userId, username: user.profile.username, displayName: displayName || user.profile.displayName, avatarUrl }} size={96} />
        <div className="photoedit__actions">
          <input ref={fileRef} type="file" accept="image/*" className="visually-hidden" aria-label="Escolher foto de perfil" id="foto" onChange={pickPhoto} />
          <Button variant="secondary" small loading={photoBusy} onClick={() => fileRef.current?.click()}>
            {avatarUrl ? 'Trocar foto' : 'Subir foto'}
          </Button>
          {avatarUrl ? (
            <Button variant="quiet" small disabled={photoBusy} onClick={removePhoto}>
              Remover foto
            </Button>
          ) : null}
        </div>
      </div>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <form className="form form--flat" onSubmit={save} noValidate>
        <Field label="Nome" value={displayName} onChange={setDisplayName} error={errors['displayName']} maxLength={60} autoComplete="name" />
        <Field label="Descrição" value={bio} onChange={setBio} error={errors['bio']} hint={`${Array.from(bio).length}/${BIO_MAX}`} multiline maxLength={BIO_MAX + 20} />
        <div>
          <Button type="submit" loading={saving}>
            Salvar alterações
          </Button>
        </div>
      </form>
    </>
  );
}

export function SettingsScreen() {
  useTitle('Configuração');
  const user = useUser();
  return (
    <>
      <PageHead title="Configuração" back="/perfil" />
      <dl className="eventpage__facts">
        <div>
          <dt>Usuário</dt>
          <dd>@{user.profile.username}</dd>
        </div>
        <div>
          <dt>E-mail</dt>
          <dd>{user.email}</dd>
        </div>
      </dl>
      <p className="muted">Ainda não dá para trocar o e-mail ou a senha por aqui. Isso entra numa próxima etapa.</p>
      <h2 className="profile__section">Avisos no aparelho</h2>
      <PushCard />
      <h2 className="profile__section">Silenciar push</h2>
      <MuteCard />
      <nav className="linklist" aria-label="Sua conta">
        <Link to="/amigos">Amigos</Link>
        <Link to="/bloqueados">Pessoas bloqueadas</Link>
      </nav>
    </>
  );
}

export function PrivacyScreen() {
  useTitle('Privacidade');
  const user = useUser();
  const { setOwnProfile } = useAuthContext();
  const [isPrivate, setIsPrivate] = useState(user.profile.isPrivate);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>();

  async function toggle() {
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await api.setPrivacy(!isPrivate);
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
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead title="Privacidade" back="/perfil" />
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <section className="setting">
        <div className="setting__text">
          <h2 className="setting__title" id="privado-titulo">
            Perfil privado
          </h2>
          <p className="setting__help">Com o perfil privado, só quem você aprova vê seus eventos postados, sua agenda e suas conexões.</p>
        </div>
        <button type="button" role="switch" aria-checked={isPrivate} aria-labelledby="privado-titulo" className="switch" onClick={toggle} disabled={busy}>
          <span className="switch__thumb" />
        </button>
      </section>
      <PersonalizeSetting userId={user.profile.userId} />
      <nav className="linklist" aria-label="Privacidade">
        <Link to="/atividades">Pedidos para seguir</Link>
        <Link to="/bloqueados">Pessoas bloqueadas</Link>
        <Link to={`/u/${encodeURIComponent(user.profile.username)}`}>Ver como os outros veem</Link>
      </nav>
    </>
  );
}

/** Recomendações que usam o tempo que você fica em cada conteúdo. Ligado por padrão; dá para desligar e apagar o histórico. */
function PersonalizeSetting({ userId }: { userId: string }) {
  const [on, setOn] = useState(() => readPersonalize(userId));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>();

  async function change() {
    const next = !on;
    setOn(next);
    savePersonalize(userId, next);
    if (next) {
      setMessage({ tone: 'ok', text: 'Recomendações personalizadas ligadas.' });
      return;
    }
    // Desligar também apaga o que já foi medido.
    setBusy(true);
    try {
      await api.eraseDwell();
      setMessage({ tone: 'ok', text: 'Desligado. Apagamos o seu histórico de tempo na tela. Você ainda vê o que os amigos fizeram, mas sem usar o seu comportamento.' });
    } catch (failure) {
      setMessage({ tone: 'error', text: `Desligamos, mas não deu para apagar o histórico agora: ${toApiError(failure).message}` });
    } finally {
      setBusy(false);
    }
  }

  async function erase() {
    setBusy(true);
    try {
      const r = await api.eraseDwell();
      setMessage({ tone: 'ok', text: r.removed > 0 ? 'Histórico apagado.' : 'Não havia nada para apagar.' });
    } catch (failure) {
      setMessage({ tone: 'error', text: toApiError(failure).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <section className="setting">
        <div className="setting__text">
          <h2 className="setting__title" id="personalizar-titulo">
            Recomendações personalizadas
          </h2>
          <p className="setting__help">O app mede quanto tempo você fica em cada post ou evento e com quem você mais conversa (só quando e com quem, nunca o texto). Usa isso, junto com o que seus amigos mais próximos foram ou curtiram, para montar o bloco “Para você”. As medições ficam 60 dias e ninguém vê. A equipe vê apenas totais, nunca o seu histórico.</p>
        </div>
        <button type="button" role="switch" aria-checked={on} aria-labelledby="personalizar-titulo" className="switch" onClick={() => void change()} disabled={busy}>
          <span className="switch__thumb" />
        </button>
      </section>
      <div className="setting__actions">
        <Button variant="quiet" small loading={busy} onClick={() => void erase()}>
          Apagar meu histórico de tempo na tela
        </Button>
      </div>
    </>
  );
}

export function InteractionsScreen() {
  useTitle('Suas interações');
  const meetups = useAsync(() => api.myMeetups(), []);
  const requests = useAsync(() => api.followRequests({ limit: 1 }), []);
  const items = meetups.data?.items ?? [];
  const now = Date.now();
  const upcoming = items.filter((m) => m.status === 'ACTIVE' && Date.parse(m.endsAt) > now);
  const past = items.filter((m) => !upcoming.includes(m));

  const row = (m: (typeof items)[number]) => (
    <li key={m.id}>
      <Link to={`/conversas/${encodeURIComponent(m.conversationId)}`} className="inter__row">
        <span className="inter__title">{m.title}</span>
        <span className="inter__sub">{m.status === 'CANCELLED' ? 'Cancelado' : formatWhen(m.startsAt, m.endsAt, new Date())}</span>
        {statusLabel(m.myStatus) ? <span className="inter__sub">{statusLabel(m.myStatus)}</span> : null}
      </Link>
    </li>
  );

  return (
    <>
      <PageHead title="Suas interações" back="/perfil" />
      {(requests.data?.total ?? 0) > 0 ? (
        <Link to="/atividades" className="callout callout--link">
          <span className="callout__text">
            <strong>{pluralize(requests.data?.total ?? 0, 'pedido para seguir', 'pedidos para seguir')}</strong>
            <br />
            Aprove ou recuse em Notificações.
          </span>
        </Link>
      ) : null}
      <h2 className="profile__section">Seus encontros</h2>
      {meetups.loading && !meetups.data ? <Loading /> : null}
      {meetups.error ? <ErrorState message={meetups.error.message} onRetry={meetups.reload} /> : null}
      {meetups.data && items.length === 0 ? (
        <EmptyState
          title="Nenhum encontro ainda"
          action={
            <Link to="/explorar" className="btn btn--primary">
              Explorar eventos
            </Link>
          }
        >
          Os encontros que você criar ou for convidado aparecem aqui.
        </EmptyState>
      ) : null}
      {upcoming.length > 0 ? <ul className="inter">{upcoming.map(row)}</ul> : null}
      {past.length > 0 ? (
        <>
          <h2 className="profile__section">Anteriores</h2>
          <ul className="inter">{past.map(row)}</ul>
        </>
      ) : null}
      <h2 className="profile__section">Seus eventos</h2>
      <Link to="/perfil" className="callout callout--link">
        <span className="callout__text">
          <strong>Eventos postados no perfil</strong>
          <br />
          Veja e tire eventos do seu perfil. Para postar, abra um evento e use Compartilhar.
        </span>
      </Link>
    </>
  );
}

const FAQ: { q: string; a: string }[] = [
  { q: 'Como viro amigo de alguém?', a: 'Vocês viram amigos quando se seguem. Se o perfil for privado, a pessoa precisa aprovar seu pedido.' },
  { q: 'Como posto um evento no meu perfil?', a: 'Abra o evento em Explorar, toque em Compartilhar e escolha Postar no meu perfil. Para tirar, use o mesmo botão ou Tirar do perfil na grade.' },
  { q: 'Como compartilho um evento?', a: 'No evento, toque em Compartilhar: poste no perfil, envie numa conversa ou copie o link para mandar fora do app, por exemplo no WhatsApp.' },
  { q: 'Como marco um encontro?', a: 'No evento, toque em Criar encontro e escolha quem convidar. Quem aceitar vê o encontro na Agenda.' },
  { q: 'O que é o Flash?', a: 'É o botão para avisar seus amigos que você está livre agora. Quem também estiver livre pode te chamar, e a conversa abre na hora. Ele fica na barra de baixo.' },
  { q: 'Onde ficam minhas conversas?', a: 'No ícone de balão, no topo da tela. Um número mostra quantas conversas têm mensagem nova.' },
  { q: 'Para que serve a Agenda?', a: 'Ela mostra os eventos em que você confirmou presença e os encontros marcados. Você também pode marcar quando está livre. Só você vê.' },
  { q: 'Os eventos de exemplo são reais?', a: 'Não. Eventos marcados como Exemplo de teste existem só para testar o app.' },
  { q: 'Como troco foto, nome ou descrição?', a: 'No seu perfil, toque no lápis.' },
];

export function HelpScreen() {
  useTitle('Ajuda');
  const user = useUser();
  const mailto = supportMailto(import.meta.env.VITE_SUPPORT_EMAIL as string | undefined, user.profile.username);
  return (
    <>
      <PageHead title="Ajuda" back="/perfil" />
      <div className="faq">
        {FAQ.map((item) => (
          <details key={item.q} className="faq__item">
            <summary>{item.q}</summary>
            <p>{item.a}</p>
          </details>
        ))}
      </div>
      {mailto ? (
        <a className="btn btn--secondary btn--full" href={mailto}>
          Falar com o suporte
        </a>
      ) : (
        <p className="muted">O canal de suporte por e-mail ainda não foi ativado.</p>
      )}
    </>
  );
}

export function ThemeScreen() {
  useTitle('Tema');
  const [choice, setChoice] = useState<ThemeChoice>(() => readTheme(window.localStorage));
  function pick(next: ThemeChoice) {
    setChoice(next);
    applyTheme(next, document.documentElement);
    saveTheme(next, window.localStorage);
  }
  return (
    <>
      <PageHead title="Tema" back="/perfil" />
      <div className="radios" role="radiogroup" aria-label="Tema">
        {(['system', 'light', 'dark'] as const).map((id) => (
          <label key={id} className="radios__item">
            <input type="radio" name="tema" checked={choice === id} onChange={() => pick(id)} />
            <span>{THEME_LABELS[id]}</span>
          </label>
        ))}
      </div>
    </>
  );
}

export function FriendsScreen() {
  useTitle('Amigos');
  const friends = useAsync(() => api.friends(), []);
  const [inviting, setInviting] = useState(false);
  return (
    <>
      <PageHead title="Amigos" back="/perfil" subtitle="Pessoas que seguem você e que você segue" action={<Link to="/amigos/contatos">Achar nos contatos</Link>} />
      <Button full variant="secondary" onClick={() => setInviting(true)}>
        Convidar amigos para o AskouT
      </Button>
      {inviting ? <InviteSheet onClose={() => setInviting(false)} /> : null}
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
