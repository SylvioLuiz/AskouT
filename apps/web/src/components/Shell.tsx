import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useUser } from '../auth.tsx';
import { api } from '../client.ts';
import { useAsync, usePolling } from '../hooks.ts';
import { CHATS_CHANGED_EVENT } from '../lib/chat.ts';
import { FLASH_CHANGED_EVENT } from '../lib/flash.ts';
import { NOTIFICATIONS_CHANGED_EVENT } from '../lib/notifications.ts';
import { Link, navigate, usePathname } from '../router.tsx';
import { BellIcon, BoltIcon, CalendarIcon, ChatIcon, HomeIcon, PlusBigIcon, SearchIcon, UserIcon } from './icons.tsx';
import { Avatar } from './ui.tsx';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  /** Prefixos de caminho que também deixam o item ativo. */
  also?: string[];
}

const MAIN: NavItem[] = [
  { to: '/', label: 'Home', icon: <HomeIcon /> },
  { to: '/explorar', label: 'Explorar', icon: <SearchIcon /> },
  { to: '/conversas', label: 'Conversas', icon: <ChatIcon /> },
  { to: '/agenda', label: 'Agenda', icon: <CalendarIcon /> },
];

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

export function Shell({ children }: { children: ReactNode }) {
  const user = useUser();
  const pathname = usePathname();
  // Solicitações de seguir pendentes: alimentam a bolinha em Atividades.
  const pending = useAsync(() => api.followRequests({ limit: 1 }), [pathname]);
  const unreadNews = useAsync(() => api.unreadNotifications(), [pathname]);
  usePolling(unreadNews.reload, 20_000);
  useEffect(() => {
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, unreadNews.reload);
    return () => window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, unreadNews.reload);
  }, [unreadNews.reload]);
  // Tocar num aviso do aparelho com o app aberto: o service worker pede para abrir a tela certa.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; url?: unknown } | null;
      if (data?.type === 'askout:navigate' && typeof data.url === 'string' && data.url.startsWith('/')) navigate(data.url);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, []);
  const hasPending = (pending.data?.total ?? 0) > 0 || (unreadNews.data?.unread ?? 0) > 0;
  // Flash: o raio fica cheio com o Flash ligado e ganha uma bolinha quando alguém te convida.
  const flash = useAsync(() => api.flashStatus(), [pathname]);
  const flashInvites = useAsync(() => api.flashInvites(), [pathname]);
  const reloadFlash = () => {
    flash.reload();
    flashInvites.reload();
  };
  usePolling(reloadFlash, 30_000);
  useEffect(() => {
    window.addEventListener(FLASH_CHANGED_EVENT, reloadFlash);
    return () => window.removeEventListener(FLASH_CHANGED_EVENT, reloadFlash);
  });
  // Conversas: bolinha quando há mensagem não lida.
  const convs = useAsync(() => api.conversations(), [pathname]);
  usePolling(convs.reload, 15_000);
  useEffect(() => {
    window.addEventListener(CHATS_CHANGED_EVENT, convs.reload);
    return () => window.removeEventListener(CHATS_CHANGED_EVENT, convs.reload);
  }, [convs.reload]);
  const hasUnread = (convs.data?.items ?? []).some((c) => c.unread > 0);
  const inChat = /^\/conversas\/[^/]+$/.test(pathname);
  const flashOn = flash.data?.active === true;
  const flashInvited = (flashInvites.data?.received.length ?? 0) > 0;
  const flashLabel = flashInvited ? 'Flash, você tem um convite' : flashOn ? 'Flash, ligado' : 'Flash';

  const flashItem: NavItem = { to: '/flash', label: 'Flash', icon: <BoltIcon filled={flashOn} />, also: ['/flash/encontro'] };
  const createItem: NavItem = { to: '/criar', label: 'Criar post', icon: <PlusBigIcon /> };
  const activities: NavItem = { to: '/atividades', label: 'Atividades', icon: <BellIcon /> };
  const profile: NavItem = {
    to: '/perfil',
    label: 'Perfil',
    icon: <UserIcon />,
    also: ['/amigos', '/bloqueados', '/configuracao', '/privacidade', '/interacoes', '/ajuda', '/tema'],
  };

  return (
    <div className={`shell${inChat ? ' shell--chat' : ''}`}>
      <a className="skip" href="#conteudo">
        Ir para o conteúdo
      </a>

      <aside className="rail">
        <Link to="/" className="wordmark" aria-label="AskouT, ir para a Home">
          AskouT
        </Link>
        <nav className="rail__nav" aria-label="Principal">
          {MAIN.map((item) => (
            <NavLink key={item.to} item={item} pathname={pathname} badge={item.to === '/conversas' && hasUnread} />
          ))}
          <NavLink item={createItem} pathname={pathname} />
          <NavLink item={flashItem} pathname={pathname} badge={flashInvited} />
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

      <header className="topbar">
        <Link to="/" className="wordmark" aria-label="AskouT, ir para a Home">
          AskouT
        </Link>
        <nav className="topbar__actions" aria-label="Conta">
          <Link to="/flash" className={`iconbtn iconbtn--flash${flashOn ? ' iconbtn--on' : ''}`} aria-label={flashLabel} aria-current={pathname.startsWith('/flash') ? 'page' : undefined}>
            <BoltIcon filled={flashOn} />
            {flashInvited ? <span className="navlink__badge" aria-hidden="true" /> : null}
          </Link>
          <Link to="/atividades" className="iconbtn" aria-label={hasPending ? 'Atividades, há novidades' : 'Atividades'} aria-current={pathname === '/atividades' ? 'page' : undefined}>
            <BellIcon />
            {hasPending ? <span className="navlink__badge" aria-hidden="true" /> : null}
          </Link>
          <Link to="/perfil" className="iconbtn" aria-label="Perfil" aria-current={pathname === '/perfil' ? 'page' : undefined}>
            <UserIcon />
          </Link>
        </nav>
      </header>

      <main id="conteudo" className="content" tabIndex={-1}>
        {children}
      </main>

      <nav className="tabbar" aria-label="Principal">
        {MAIN.slice(0, 2).map((item) => (
          <NavLink key={item.to} item={item} pathname={pathname} />
        ))}
        <Link to="/criar" className={`tabbar__create${pathname === '/criar' ? ' tabbar__create--active' : ''}`} aria-label="Criar post" aria-current={pathname === '/criar' ? 'page' : undefined}>
          <PlusBigIcon />
        </Link>
        {MAIN.slice(2).map((item) => (
          <NavLink key={item.to} item={item} pathname={pathname} badge={item.to === '/conversas' && hasUnread} />
        ))}
      </nav>
    </div>
  );
}
