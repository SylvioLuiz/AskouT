import { BoltIcon } from '../components/icons.tsx';
import { EmptyState, PageHead } from '../components/ui.tsx';
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

