import { BoltIcon, CalendarIcon } from '../components/icons.tsx';
import { EmptyState, PageHead } from '../components/ui.tsx';
import { api } from '../client.ts';
import { useUser } from '../auth.tsx';
import { ForYou } from '../components/for-you.tsx';
import { useMemo, useState } from 'react';
import { agendaEvents, nextPlan, planWhenLabel } from '../lib/agenda.ts';
import { useAsync, useTitle } from '../hooks.ts';
import { PullRefresh } from '../components/pull-refresh.tsx';
import { formatRemaining, minutesLeft } from '../lib/flash.ts';
import { showFlashCard } from '../lib/age.ts';
import { PostList } from '../components/post.tsx';
import { Link } from '../router.tsx';
import { SuggestedPeople } from '../components/suggested-people.tsx';
import { EventCard } from './explore.tsx';

export function HomeScreen() {
  useTitle('Home');
  const user = useUser();
  const flash = useAsync(() => api.flashStatus(), []);
  const age = useAsync(() => api.ageStatus(), []);
  const flashOn = flash.data?.active === true;
  const followed = useAsync(() => api.followedEvents(), []);
  const followedEvents = followed.data?.events ?? [];
  const sponsored = useAsync(() => api.sponsoredEvents(), []);
  const sponsoredEvents = sponsored.data?.events ?? [];
  const now = new Date();
  const [feedKey, setFeedKey] = useState(0);
  const meetups = useAsync(() => api.myMeetups(), []);
  const going = useAsync(() => api.myGoingEvents(), []);
  const plan = useMemo(() => nextPlan(agendaEvents(meetups.data?.items ?? [], going.data?.items ?? []), new Date()), [meetups.data, going.data]);

  return (
    <PullRefresh
      onRefresh={async () => {
        setFeedKey((k) => k + 1);
        flash.reload();
        followed.reload();
        sponsored.reload();
        meetups.reload();
        going.reload();
        await new Promise((resolve) => setTimeout(resolve, 700));
      }}
    >
      <PageHead title={`Olá, ${user.profile.displayName}`} />

      {plan ? (
        <Link to="/agenda" className="nextplan" aria-label={`Seu próximo plano: ${planWhenLabel(plan, now)}, ${plan.title}. Abrir a agenda`}>
          <span className="nextplan__icon" aria-hidden="true">
            <CalendarIcon />
          </span>
          <span className="nextplan__text">
            <strong>{planWhenLabel(plan, now)}</strong> · {plan.title}
          </span>
        </Link>
      ) : null}

      {showFlashCard(age.data) ? (
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
      ) : null}

      {followedEvents.length > 0 ? (
        <section className="section" aria-labelledby="seguindo-titulo">
          <div className="section__head">
            <h2 id="seguindo-titulo" className="section__title">
              Eventos dos rolês que você segue
            </h2>
          </div>
          <ul className="evposters">
            {followedEvents.map((event) => (
              <EventCard key={event.id} event={event} now={now} poster />
            ))}
          </ul>
        </section>
      ) : null}

      {sponsoredEvents.length > 0 ? (
        <section className="section" aria-labelledby="patrocinado-titulo">
          <div className="section__head">
            <h2 id="patrocinado-titulo" className="section__title">
              Rolês em destaque
            </h2>
            <span className="tag-sponsored">Patrocinado</span>
          </div>
          <ul className="evposters">
            {sponsoredEvents.map((event) => (
              <EventCard key={event.id} event={event} now={now} poster />
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
        <PostList load={(offset) => api.postsFeed({ limit: 6, offset })} emptyTitle="Ainda não há posts" emptyHint="Seus posts e os dos seus amigos aparecem aqui." inject={[{ after: 2, node: <ForYou reloadKey={String(feedKey)} /> }, { after: 5, node: <SuggestedPeople /> }]} reloadKey={String(feedKey)} />
      </section>
    </PullRefresh>
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

