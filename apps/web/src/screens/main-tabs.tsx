import { BoltIcon, CalendarIcon, UsersIcon } from '../components/icons.tsx';
import { InviteSheet } from '../components/invite.tsx';
import { showInviteCard } from '../lib/invite.ts';
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
import { t } from '../lib/i18n/index.ts';

export function HomeScreen() {
  useTitle(t('Home'));
  const user = useUser();
  const flash = useAsync(() => api.flashStatus(), []);
  const friends = useAsync(() => api.friends(), []);
  const me = useAsync(() => api.getProfile(user.profile.username), [user.profile.username]);
  const [inviting, setInviting] = useState(false);
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
        friends.reload();
        me.reload();
        followed.reload();
        sponsored.reload();
        meetups.reload();
        going.reload();
        await new Promise((resolve) => setTimeout(resolve, 700));
      }}
    >
      <PageHead title={t('Olá, {name}', { name: user.profile.displayName })} />

      {plan ? (
        <Link to="/agenda" className="nextplan" aria-label={t('Seu próximo plano: {now}, {title}. Abrir a agenda', { now: planWhenLabel(plan, now), title: plan.title })}>
          <span className="nextplan__icon" aria-hidden="true">
            <CalendarIcon />
          </span>
          <span className="nextplan__text">
            <strong>{planWhenLabel(plan, now)}</strong> · {plan.title}
          </span>
        </Link>
      ) : null}

      {showInviteCard(friends.data?.length) ? (
        <button type="button" className="invitecta" onClick={() => setInviting(true)}>
          <span className="invitecta__icon" aria-hidden="true">
            <UsersIcon />
          </span>
          <span className="invitecta__text">
            <span className="invitecta__title">{t('Chame a galera')}</span>
            <span className="invitecta__sub">{t('O AskouT é melhor com os amigos. Compartilhe o link.')}</span>
          </span>
        </button>
      ) : null}
      {inviting ? <InviteSheet onClose={() => setInviting(false)} /> : null}

      {showFlashCard(me.data?.counts.following) ? (
        <Link to="/flash" className={`flashcta${flashOn ? ' flashcta--on' : ''}`}>
          <span className="flashcta__icon">
            <BoltIcon filled />
          </span>
          <span className="flashcta__text">
            <span className="flashcta__title">{flashOn ? t('Flash ligado') : t('Flash: estou livre agora')}</span>
            <span className="flashcta__sub">
              {flashOn && flash.data?.expiresAt
                ? t('Faltam {now}. Veja quem mais está livre.', { now: formatRemaining(minutesLeft(flash.data.expiresAt, Date.now())) })
                : t('Avise seus amigos que dá para sair agora.')}
            </span>
          </span>
        </Link>
      ) : null}

      {followedEvents.length > 0 ? (
        <section className="section" aria-labelledby="seguindo-titulo">
          <div className="section__head">
            <h2 id="seguindo-titulo" className="section__title">
              {t('Eventos dos rolês que você segue')}
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
              {t('Rolês em destaque')}
            </h2>
            <span className="tag-sponsored">{t('Patrocinado')}</span>
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
            {t('Posts dos amigos')}
          </h2>
          <Link to="/criar">{t('Criar post')}</Link>
        </div>
        <PostList load={(offset) => api.postsFeed({ limit: 6, offset })} emptyTitle={t('Ainda não há posts')} emptyHint={t('Seus posts e os dos seus amigos aparecem aqui.')} inject={[{ after: 2, node: <ForYou reloadKey={String(feedKey)} /> }, { after: 5, node: <SuggestedPeople /> }]} reloadKey={String(feedKey)} />
      </section>
    </PullRefresh>
  );
}

export function SoonScreen({ title, text }: { title: string; text: string }) {
  useTitle(title);
  return (
    <>
      <PageHead title={title} />
      <EmptyState title={t('Ainda não está disponível')}>{text}</EmptyState>
    </>
  );
}

