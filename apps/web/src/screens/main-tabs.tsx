import { BoltIcon } from '../components/icons.tsx';
import { Avatar, EmptyState, ErrorState, Loading, PageHead, PersonRow } from '../components/ui.tsx';
import { api } from '../client.ts';
import { useUser } from '../auth.tsx';
import { useAsync, useTitle } from '../hooks.ts';
import { formatRemaining, minutesLeft } from '../lib/flash.ts';
import { Link } from '../router.tsx';

export function HomeScreen() {
  useTitle('Home');
  const user = useUser();
  const friends = useAsync(() => api.friends(), []);
  const count = friends.data?.length ?? 0;
  const flash = useAsync(() => api.flashStatus(), []);
  const flashOn = flash.data?.active === true;

  return (
    <>
      <PageHead title={`Olá, ${user.profile.displayName}`} />

      <Link to="/flash" className={`flashcta${flashOn ? ' flashcta--on' : ''}`}>
        <span className="flashcta__icon">
          <BoltIcon filled />
        </span>
        <span className="flashcta__text">
          <span className="flashcta__title">{flashOn ? 'Flash ligado' : 'Flash: estou livre agora'}</span>
          <span className="flashcta__sub">
            {flashOn && flash.data?.expiresAt
              ? `Faltam ${formatRemaining(minutesLeft(flash.data.expiresAt, Date.now()))}. Veja quem mais está livre.`
              : 'Avise seus amigos que dá para sair agora.'}
          </span>
        </span>
      </Link>

      <section className="section" aria-labelledby="amigos-titulo">
        <div className="section__head">
          <h2 id="amigos-titulo" className="section__title">
            Seus amigos
          </h2>
          {friends.data && count > 0 ? <Link to="/amigos">Ver todos ({count})</Link> : null}
        </div>
        {friends.loading ? <Loading /> : null}
        {friends.error ? <ErrorState message={friends.error.message} onRetry={friends.reload} /> : null}
        {friends.data && count === 0 ? (
          <EmptyState
            title="Você ainda não tem amigos no AskouT"
            action={
              <Link to="/explorar" className="btn btn--primary">
                Encontrar pessoas
              </Link>
            }
          >
            Amigos são pessoas que seguem você e que você segue de volta. Procure alguém pelo nome ou @usuário.
          </EmptyState>
        ) : null}
        {friends.data && count > 0 ? (
          <>
            <div className="avatars" aria-hidden="true">
              {friends.data.slice(0, 6).map((friend) => (
                <Avatar key={friend.userId} profile={friend} size={40} />
              ))}
            </div>
            <ul className="list">
              {friends.data.slice(0, 5).map((friend) => (
                <PersonRow key={friend.userId} profile={friend} />
              ))}
            </ul>
          </>
        ) : null}
      </section>

      <section className="section">
        <h2 className="section__title">O que vem por aí</h2>
        <p className="muted">
          Encontros marcados pela agenda e as conversas ainda não estão no app. Quando chegarem, aparecem aqui.
        </p>
      </section>
    </>
  );
}

export function SoonScreen({ title, text }: { title: string; text: string }) {
  useTitle(title);
  return (
    <>
      <PageHead title={title} />
      <EmptyState title="Ainda não está disponível">{text}</EmptyState>
    </>
  );
}

