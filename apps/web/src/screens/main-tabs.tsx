import { BoltIcon } from '../components/icons.tsx';
import { Avatar, EmptyState, ErrorState, Loading, PageHead, PersonRow } from '../components/ui.tsx';
import { api } from '../client.ts';
import { useUser } from '../auth.tsx';
import { useAsync, useTitle } from '../hooks.ts';
import { formatRemaining, minutesLeft } from '../lib/flash.ts';
import { PostList } from '../components/post.tsx';
import { Link } from '../router.tsx';
import { SuggestedPeople } from '../components/suggested-people.tsx';
import { EventCard } from './explore.tsx';

export function HomeScreen() {
  useTitle('Home');
  const user = useUser();
  const friends = useAsync(() => api.friends(), []);
  const count = friends.data?.length ?? 0;
  const flash = useAsync(() => api.flashStatus(), []);
  const flashOn = flash.data?.active === true;
  const followed = useAsync(() => api.followedEvents(), []);
  const followedEvents = followed.data?.events ?? [];
  const now = new Date();

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

      {followedEvents.length > 0 ? (
        <section className="section" aria-labelledby="seguindo-titulo">
          <div className="section__head">
            <h2 id="seguindo-titulo" className="section__title">
              Eventos dos bares que você segue
            </h2>
          </div>
          <ul className="evgrid">
            {followedEvents.map((event) => (
              <EventCard key={event.id} event={event} now={now} />
            ))}
          </ul>
        </section>
      ) : null}

      <section className="section" aria-labelledby="posts-titulo">
        <div className="section__head">
          <h2 id="posts-titulo" className="section__title">
            Posts dos amigos
          </h2>
          <Link to="/criar">Criar post</Link>
        </div>
        <PostList load={(offset) => api.postsFeed({ limit: 6, offset })} emptyTitle="Ainda não há posts" emptyHint="Seus posts e os dos seus amigos aparecem aqui." inject={{ after: 5, node: <SuggestedPeople /> }} />
      </section>

      <section className="section" aria-labelledby="amigos-titulo">
        <div className={`section__head${friends.data && count === 0 ? ' visually-hidden' : ''}`}>
          <h2 id="amigos-titulo" className="section__title">
            Seus amigos
          </h2>
          {friends.data && count > 0 ? <Link to="/amigos">Ver todos ({count})</Link> : null}
        </div>
        {friends.loading ? <Loading /> : null}
        {friends.error ? <ErrorState message={friends.error.message} onRetry={friends.reload} /> : null}
        {friends.data && count === 0 ? (
          <div className="welcome">
            <h2>Encontre seus amigos</h2>
            <p>Amigos são pessoas que seguem você e que você segue de volta.</p>
            <Link to="/explorar" className="btn btn--primary">
              Encontrar pessoas
            </Link>
          </div>
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

