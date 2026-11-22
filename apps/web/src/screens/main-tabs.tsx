import { BoltIcon, CalendarIcon } from '../components/icons.tsx';
import { EmptyState, PageHead } from '../components/ui.tsx';
import { api } from '../client.ts';
import { useUser } from '../auth.tsx';
import { ForYou } from '../components/for-you.tsx';
import { OfferBanner } from '../components/offer-banner.tsx';
import { useMemo, useState } from 'react';
import { agendaEvents, nextPlan, planWhenLabel } from '../lib/agenda.ts';
import { useAsync, useTitle } from '../hooks.ts';
import { PullRefresh } from '../components/pull-refresh.tsx';
import { formatRemaining, minutesLeft } from '../lib/flash.ts';
import { showFlashCard } from '../lib/age.ts';
import { PostList } from '../components/post.tsx';
import { Link } from '../router.tsx';
import { SuggestedPeople } from '../components/suggested-people.tsx';
import { FriendStories } from '../components/friend-stories.tsx';
import { VenueStoriesStrip } from '../components/venue-story.tsx';
import { EventCard } from './explore.tsx';
import { t } from '../lib/i18n/index.ts';
import { useWideDesktop } from '../lib/use-desktop.ts';

export function HomeScreen() {
  useTitle(t('Home'));
  const user = useUser();
  const flash = useAsync(() => api.flashStatus(), []);
  const me = useAsync(() => api.getProfile(user.profile.username), [user.profile.username]);
  const flashOn = flash.data?.active === true;
  const followed = useAsync(() => api.followedEvents(), []);
  const followedEvents = followed.data?.events ?? [];
  const sponsored = useAsync(() => api.sponsoredEvents(), []);
  const sponsoredEvents = sponsored.data?.events ?? [];
  const now = new Date();
  const [feedKey, setFeedKey] = useState(0);
  const meetups = useAsync(() => api.myMeetups(), []);
  const going = useAsync(() => api.myGoingEvents(), []);
  const stories = useAsync(() => api.profileStories(), []);
  const venueStories = useAsync(() => api.venueStoriesHome(), []);
  const wide = useWideDesktop();
  const plan = useMemo(() => nextPlan(agendaEvents(meetups.data?.items ?? [], going.data?.items ?? []), new Date()), [meetups.data, going.data]);

  // Próximo plano e NOW: no celular ficam no meio do feed; no computador largo, na coluna da direita.
  const highlights = (
    <>
        {plan ? (
          <Link to="/agenda" className="nextplan enter" aria-label={t('Seu próximo plano: {now}, {title}. Abrir a agenda', { now: planWhenLabel(plan, now), title: plan.title })}>
            <span className="nextplan__icon" aria-hidden="true">
              <CalendarIcon />
            </span>
            <span className="nextplan__text">
              <strong>{planWhenLabel(plan, now)}</strong> · {plan.title}
            </span>
          </Link>
        ) : null}

        {showFlashCard(me.data?.counts.following) ? (
          <Link to="/now" className={`flashcta enter${flashOn ? ' flashcta--on' : ''}`}>
            <span className="flashcta__icon">
              <BoltIcon filled />
            </span>
            <span className="flashcta__text">
              <span className="flashcta__title">{flashOn ? t('NOW ligado') : t('NOW: estou livre agora')}</span>
              <span className="flashcta__sub">
                {flashOn && flash.data?.expiresAt
                  ? t('Faltam {now}. Veja quem mais está livre.', { now: formatRemaining(minutesLeft(flash.data.expiresAt, Date.now())) })
                  : t('Avise seus amigos que dá para sair agora.')}
              </span>
            </span>
          </Link>
        ) : null}
    </>
  );

  return (
    <PullRefresh
      onRefresh={async () => {
        setFeedKey((k) => k + 1);
        flash.reload();
        me.reload();
        followed.reload();
        sponsored.reload();
        meetups.reload();
        going.reload();
        stories.reload();
        venueStories.reload();
        await new Promise((resolve) => setTimeout(resolve, 700));
      }}
    >
      <div className="homegrid">
      <div className="homegrid__main">
      <FriendStories groups={stories.data?.groups ?? []} onChanged={stories.reload} />
      <VenueStoriesStrip groups={venueStories.data?.groups ?? []} onChanged={venueStories.reload} />

      <OfferBanner reloadKey={feedKey} />

      {wide ? null : highlights}

      {followedEvents.length > 0 ? (
        <section className="section enter" aria-labelledby="seguindo-titulo">
          <div className="section__head">
            <h2 id="seguindo-titulo" className="section__title">
              {t('Eventos dos locais que você segue')}
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
        <section className="section enter" aria-labelledby="patrocinado-titulo">
          <div className="section__head">
            <h2 id="patrocinado-titulo" className="section__title">
              {t('Locais em destaque')}
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

      {/* Sem título: o normal da página inicial são os posts de quem você segue. Só as recomendações ("Para você") têm título. */}
      <section className="section" aria-label={t('Posts de quem você segue')}>
        {/* Na página inicial, os posts seguem o desenho dos eventos: nome de quem postou em cima, ações embaixo. */}
        <PostList dateRail enter poster={false} load={(offset, before) => api.homeFeed({ limit: 6, offset }, before)} emptyTitle={t('Ainda não há posts')} emptyHint={t('Seus posts e os de quem você segue aparecem aqui.')} inject={wide ? [{ after: 2, node: <ForYou reloadKey={String(feedKey)} /> }] : [{ after: 2, node: <ForYou reloadKey={String(feedKey)} /> }, { after: 5, node: <SuggestedPeople /> }]} reloadKey={String(feedKey)} />
      </section>
      </div>
      {wide ? (
        <aside className="homegrid__side" aria-label={t('Seus planos e sugestões')}>
          {highlights}
          <SuggestedPeople />
          <footer className="homegrid__foot">
            <Link to="/termos-de-uso">{t('Termos de Uso')}</Link>
            <Link to="/politica-de-privacidade">{t('Política de Privacidade')}</Link>
            <span>© {new Date().getFullYear()} {t('AskouT')}</span>
          </footer>
        </aside>
      ) : null}
      </div>
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

