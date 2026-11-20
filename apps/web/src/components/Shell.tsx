import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useUser } from '../auth.tsx';
import { api } from '../client.ts';
import { PUSH_EVENT, useAsync, useLiveRefresh, usePolling } from '../hooks.ts';
import { CHATS_CHANGED_EVENT } from '../lib/chat.ts';
import { FLASH_CHANGED_EVENT } from '../lib/flash.ts';
import { hasNewActivity, NOTIFICATIONS_CHANGED_EVENT, readActivitySeen } from '../lib/notifications.ts';
import { Link, navigate, usePathname } from '../router.tsx';
import { BellIcon, BoltIcon, CalendarIcon, ChatIcon, ChevronLeftIcon, HomeIcon, ListIcon, PlusBigIcon, SearchIcon, UserIcon, UsersIcon } from './icons.tsx';
import { venueAdminRoute, venueAdminTabs } from '../lib/venue-admin-mode.ts';
import type { VenueAdminRoute, VenueAdminSection } from '../lib/venue-admin-mode.ts';
import { Avatar } from './ui.tsx';
import { CreateChooser } from './create-chooser.tsx';
import { NowInviteToast } from './now-invite.tsx';
import { t } from '../lib/i18n/index.ts';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  /** Prefixos de caminho que também deixam o item ativo. */
  also?: string[];
}

const HOME: NavItem = { to: '/', label: t('Home'), icon: <HomeIcon /> };
const EXPLORE: NavItem = { to: '/explorar', label: t('Explorar'), icon: <SearchIcon /> };
const AGENDA: NavItem = { to: '/agenda', label: t('Agenda'), icon: <CalendarIcon /> };
const CHATS: NavItem = { to: '/conversas', label: t('Conversas'), icon: <ChatIcon /> };

function isActive(item: NavItem, pathname: string): boolean {
  if (item.to === '/') return pathname === '/';
  return [item.to, ...(item.also ?? [])].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function NavLink({ item, pathname, badge }: { item: NavItem; pathname: string; badge?: boolean }) {
  const active = isActive(item, pathname);
  return (
    <Link to={item.to} className={`navlink${active ? ' navlink--active' : ''}`} aria-current={active ? 'page' : undefined}>
      <span className="navlink__icon">
        {item.icon}
        {badge ? <span className="navlink__badge" aria-hidden="true" /> : null}
      </span>
      <span className="navlink__label">{item.label}</span>
    </Link>
  );
}

const ADMIN_ICONS: Record<VenueAdminSection, ReactNode> = {
  painel: <HomeIcon />,
  eventos: <CalendarIcon />,
  agenda: <ListIcon />,
  equipe: <UsersIcon />,
  impulsionar: <BoltIcon />,
};

/**
 * Modo estabelecimento: o app vira outra área, com menu próprio embaixo (painel, eventos, agenda, equipe, impulsionar).
 * O único caminho de volta é o botão "Voltar para o perfil".
 */
function VenueAdminShell({ route, children }: { route: VenueAdminRoute; children: ReactNode }) {
  const profile = useAsync(() => api.venueProfile(route.venueId), [route.venueId]);
  const topbarRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = topbarRef.current;
    if (!el) return;
    const apply = () => document.documentElement.style.setProperty('--topbar-h', `${el.offsetHeight}px`);
    apply();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(apply) : undefined;
    observer?.observe(el);
    window.addEventListener('resize', apply);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', apply);
    };
  }, []);
  const tabs = venueAdminTabs(route.venueId, profile.data?.isOwner === true, { painel: t('Painel'), eventos: t('Eventos'), agenda: t('Agenda'), equipe: t('Equipe'), impulsionar: t('Impulsionar') });
  const name = profile.data?.name;
  const back = (
    <Link to="/perfil" className="vadminback">
      <ChevronLeftIcon />
      <span>{t('Voltar para o perfil')}</span>
    </Link>
  );
  const link = (tab: (typeof tabs)[number]) => {
    const active = tab.section === route.section;
    return (
      <Link key={tab.section} to={tab.to} className={`navlink${active ? ' navlink--active' : ''}`} aria-current={active ? 'page' : undefined}>
        <span className="navlink__icon">{ADMIN_ICONS[tab.section]}</span>
        <span className="navlink__label">{tab.label}</span>
      </Link>
    );
  };
  return (
    <div className="shell shell--venueadmin">
      <a className="skip" href="#conteudo">
        {t('Ir para o conteúdo')}
      </a>
      <aside className="rail">
        {back}
        {name ? <p className="rail__venue">{name}</p> : null}
        <nav className="rail__nav" aria-label={t('Estabelecimento')}>
          {tabs.map(link)}
        </nav>
      </aside>
      <header className="topbar topbar--venueadmin" ref={topbarRef}>
        {back}
        {name ? <span className="topbar__venue">{name}</span> : null}
      </header>
      <main id="conteudo" className="content" tabIndex={-1}>
        {children}
      </main>
      <nav className="tabbar tabbar--venueadmin" aria-label={t('Estabelecimento')} style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
        {tabs.map(link)}
      </nav>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const route = venueAdminRoute(usePathname());
  return route ? <VenueAdminShell route={route}>{children}</VenueAdminShell> : <MainShell>{children}</MainShell>;
}

function MainShell({ children }: { children: ReactNode }) {
  const user = useUser();
  const pathname = usePathname();
  // Faixas coladas no topo (como o cabeçalho da conversa) precisam saber a altura da barra do app.
  const topbarRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = topbarRef.current;
    if (!el) return;
    const apply = () => document.documentElement.style.setProperty('--topbar-h', `${el.offsetHeight}px`);
    apply();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(apply) : undefined;
    observer?.observe(el);
    window.addEventListener('resize', apply);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', apply);
    };
  }, []);
  // Solicitações de seguir pendentes: alimentam a bolinha em Atividades.
  const pending = useAsync(() => api.followRequests({ limit: 1 }), [pathname]);
  // As bolinhas (avisos, NOW, conversas) não pedem de novo a cada troca de tela: já atualizam por polling e por eventos.
  const unreadNews = useAsync(() => api.unreadNotifications(), []);
  usePolling(unreadNews.reload, 20_000);
  // O sino só mostra bolinha para o que chegou depois da última vez que Atividades foi aberta.
  const [, setSeenTick] = useState(0);
  // O + pergunta antes: postagem ou evento.
  const [choosing, setChoosing] = useState(false);
  useEffect(() => {
    const onChange = () => {
      unreadNews.reload();
      setSeenTick((n) => n + 1);
    };
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, onChange);
  }, [unreadNews.reload]);
  // Tocar num aviso do aparelho com o app aberto: o service worker pede para abrir a tela certa.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; url?: unknown } | null;
      if (data?.type === 'askout:navigate' && typeof data.url === 'string' && data.url.startsWith('/')) navigate(data.url);
      // Chegou um aviso com o app aberto: as telas que escutam (ex.: lista de conversas) atualizam na hora.
      if (data?.type === 'askout:push') window.dispatchEvent(new CustomEvent(PUSH_EVENT, { detail: { url: typeof data.url === 'string' ? data.url : '/' } }));
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, []);
  let storage: Storage | undefined;
  try {
    storage = window.localStorage;
  } catch {
    storage = undefined;
  }
  const hasPending = hasNewActivity({ latestUnreadAt: unreadNews.data?.latestUnreadAt ?? null, requests: pending.data?.total ?? 0 }, readActivitySeen(storage, user.id));
  // Flash: o raio fica cheio com o Flash ligado e ganha uma bolinha quando alguém te convida.
  const flash = useAsync(() => api.flashStatus(), []);
  const flashInvites = useAsync(() => api.flashInvites(), []);
  const reloadFlash = () => {
    flash.reload();
    flashInvites.reload();
  };
  // Convite do NOW vale só 15 minutos: confere com frequência para o aviso descer logo.
  useLiveRefresh(reloadFlash, 15_000);
  useEffect(() => {
    window.addEventListener(FLASH_CHANGED_EVENT, reloadFlash);
    return () => window.removeEventListener(FLASH_CHANGED_EVENT, reloadFlash);
  });
  // Conversas: bolinha quando há mensagem não lida.
  const convs = useAsync(() => api.conversations(), []);
  useLiveRefresh(convs.reload, 15_000);
  useEffect(() => {
    window.addEventListener(CHATS_CHANGED_EVENT, convs.reload);
    return () => window.removeEventListener(CHATS_CHANGED_EVENT, convs.reload);
  }, [convs.reload]);
  const unreadChats = (convs.data?.items ?? []).filter((c) => c.unread > 0).length;
  const hasUnread = unreadChats > 0;
  const inChat = /^\/conversas\/[^/]+$/.test(pathname);
  const inEvent = /^\/eventos\/[^/]+$/.test(pathname);
  // Criar publicação: tela cheia, como nos apps de foto (sem a barra de cima e a de baixo).
  const inCompose = pathname === '/criar';
  const flashOn = flash.data?.active === true;
  const flashInvited = (flashInvites.data?.received.length ?? 0) > 0;

  const flashItem: NavItem = { to: '/now', label: t('NOW'), icon: <BoltIcon filled={flashOn} />, also: ['/now/encontro'] };
  const activities: NavItem = { to: '/atividades', label: t('Notificações'), icon: <BellIcon /> };
  const profile: NavItem = {
    to: '/perfil',
    label: t('Perfil'),
    icon: <UserIcon />,
    // O próprio perfil também abre por /u/<usuario> (ex.: link do avatar).
    also: ['/amigos', '/bloqueados', '/configuracao', '/configuracao/senha', '/configuracao/conta', '/configuracao/notificacoes', '/configuracao/now', '/privacidade', '/privacidade/apagar-conta', '/interacoes', '/arquivados', '/albuns', '/ajuda', '/tema', `/u/${user.profile.username}`, `/u/${encodeURIComponent(user.profile.username)}`],
  };

  return (
    <div className={`shell${inChat ? ' shell--chat' : ''}${inEvent ? ' shell--detail' : ''}${inCompose ? ' shell--compose' : ''}`}>
      <a className="skip" href="#conteudo">
        {t('Ir para o conteúdo')}
      </a>

      <NowInviteToast received={flashInvites.data?.received ?? []} enabled={!pathname.startsWith('/now')} />

      <aside className="rail">
        <Link to="/" className="wordmark" aria-label={t('AskouT, ir para a Home')}>
          {t('AskouT')}
        </Link>
        <nav className="rail__nav" aria-label={t('Principal')}>
          <NavLink item={HOME} pathname={pathname} />
          <NavLink item={EXPLORE} pathname={pathname} />
          <button type="button" className={`navlink navlink--button navlink--create${inCompose ? ' navlink--active' : ''}`} onClick={() => setChoosing(true)} aria-haspopup="dialog">
            <span className="navlink__icon">
              <PlusBigIcon />
            </span>
            <span className="navlink__label">{t('Criar')}</span>
          </button>
          <NavLink item={flashItem} pathname={pathname} badge={flashInvited} />
          <NavLink item={AGENDA} pathname={pathname} />
          <NavLink item={CHATS} pathname={pathname} badge={hasUnread} />
          <NavLink item={activities} pathname={pathname} badge={hasPending} />
          <NavLink item={profile} pathname={pathname} />
        </nav>
        <Link to={`/u/${encodeURIComponent(user.profile.username)}`} className="rail__me">
          <Avatar profile={user.profile} size={36} />
          <span className="rail__who">
            <span className="rail__name">{user.profile.displayName}</span>
            <span className="rail__handle">@{user.profile.username}</span>
          </span>
        </Link>
      </aside>

      <header className="topbar" ref={topbarRef}>
        <Link to="/" className="wordmark" aria-label={t('AskouT, ir para a Home')}>
          {t('AskouT')}
        </Link>
        <nav className="topbar__actions" aria-label={t('Conta')}>
          <Link to="/conversas" className="iconbtn iconbtn--chat" aria-label={hasUnread ? t('Conversas, {unreadChats} com mensagem nova', { unreadChats }) : 'Conversas'} aria-current={pathname.startsWith('/conversas') ? 'page' : undefined}>
            <ChatIcon />
            {hasUnread ? <span className="iconbtn__count" aria-hidden="true">{unreadChats > 9 ? '9+' : unreadChats}</span> : null}
          </Link>
          <Link to="/atividades" className="iconbtn" aria-label={hasPending ? t('Notificações, há novidades') : t('Notificações')} aria-current={pathname === '/atividades' ? 'page' : undefined}>
            <BellIcon />
            {hasPending ? <span className="navlink__badge" aria-hidden="true" /> : null}
          </Link>
          <Link to="/perfil" className="iconbtn" aria-label={t('Perfil')} aria-current={isActive(profile, pathname) ? 'page' : undefined}>
            <UserIcon />
          </Link>
        </nav>
      </header>

      <main id="conteudo" className="content" tabIndex={-1}>
        {children}
      </main>

      <nav className="tabbar" aria-label={t('Principal')}>
        <NavLink item={HOME} pathname={pathname} />
        <NavLink item={EXPLORE} pathname={pathname} />
        <button type="button" className={`tabbar__create${inCompose ? ' tabbar__create--active' : ''}`} aria-label={t('Criar postagem ou evento')} aria-haspopup="dialog" onClick={() => setChoosing(true)}>
          <PlusBigIcon />
        </button>
        <NavLink item={flashItem} pathname={pathname} badge={flashInvited} />
        <NavLink item={AGENDA} pathname={pathname} />
      </nav>
      {choosing ? <CreateChooser onClose={() => setChoosing(false)} /> : null}
    </div>
  );
}
