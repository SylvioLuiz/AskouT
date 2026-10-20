import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useUser } from '../auth.tsx';
import { api } from '../client.ts';
import { useAsync, usePolling } from '../hooks.ts';
import { CHATS_CHANGED_EVENT } from '../lib/chat.ts';
import { FLASH_CHANGED_EVENT } from '../lib/flash.ts';
import { hasNewActivity, NOTIFICATIONS_CHANGED_EVENT, readActivitySeen } from '../lib/notifications.ts';
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

const HOME: NavItem = { to: '/', label: 'Home', icon: <HomeIcon /> };
const EXPLORE: NavItem = { to: '/explorar', label: 'Explorar', icon: <SearchIcon /> };
const AGENDA: NavItem = { to: '/agenda', label: 'Agenda', icon: <CalendarIcon /> };
const CHATS: NavItem = { to: '/conversas', label: 'Conversas', icon: <ChatIcon /> };

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
  const unreadNews = useAsync(() => api.unreadNotifications(), [pathname]);
  usePolling(unreadNews.reload, 20_000);
  // O sino só mostra bolinha para o que chegou depois da última vez que Atividades foi aberta.
  const [, setSeenTick] = useState(0);
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
  const unreadChats = (convs.data?.items ?? []).filter((c) => c.unread > 0).length;
  const hasUnread = unreadChats > 0;
  const inChat = /^\/conversas\/[^/]+$/.test(pathname);
  const inEvent = /^\/eventos\/[^/]+$/.test(pathname);
  const flashOn = flash.data?.active === true;
  const flashInvited = (flashInvites.data?.received.length ?? 0) > 0;

  const flashItem: NavItem = { to: '/flash', label: 'Flash', icon: <BoltIcon filled={flashOn} />, also: ['/flash/encontro'] };
  const createItem: NavItem = { to: '/criar', label: 'Criar post', icon: <PlusBigIcon /> };
  const activities: NavItem = { to: '/atividades', label: 'Notificações', icon: <BellIcon /> };
  const profile: NavItem = {
    to: '/perfil',
    label: 'Perfil',
    icon: <UserIcon />,
    also: ['/amigos', '/bloqueados', '/configuracao', '/privacidade', '/interacoes', '/arquivados', '/ajuda', '/tema'],
  };

  return (
    <div className={`shell${inChat ? ' shell--chat' : ''}${inEvent ? ' shell--detail' : ''}`}>
      <a className="skip" href="#conteudo">
        Ir para o conteúdo
      </a>

      <aside className="rail">
        <Link to="/" className="wordmark" aria-label="AskouT, ir para a Home">
          AskouT
        </Link>
        <nav className="rail__nav" aria-label="Principal">
          <NavLink item={HOME} pathname={pathname} />
          <NavLink item={EXPLORE} pathname={pathname} />
          <NavLink item={createItem} pathname={pathname} />
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
        <Link to="/" className="wordmark" aria-label="AskouT, ir para a Home">
          AskouT
        </Link>
        <nav className="topbar__actions" aria-label="Conta">
          <Link to="/conversas" className="iconbtn iconbtn--chat" aria-label={hasUnread ? `Conversas, ${unreadChats} com mensagem nova` : 'Conversas'} aria-current={pathname.startsWith('/conversas') ? 'page' : undefined}>
            <ChatIcon />
            {hasUnread ? <span className="iconbtn__count" aria-hidden="true">{unreadChats > 9 ? '9+' : unreadChats}</span> : null}
          </Link>
          <Link to="/atividades" className="iconbtn" aria-label={hasPending ? 'Notificações, há novidades' : 'Notificações'} aria-current={pathname === '/atividades' ? 'page' : undefined}>
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
        <NavLink item={HOME} pathname={pathname} />
        <NavLink item={EXPLORE} pathname={pathname} />
        <Link to="/criar" className={`tabbar__create${pathname === '/criar' ? ' tabbar__create--active' : ''}`} aria-label="Criar post" aria-current={pathname === '/criar' ? 'page' : undefined}>
          <PlusBigIcon />
        </Link>
        <NavLink item={flashItem} pathname={pathname} badge={flashInvited} />
        <NavLink item={AGENDA} pathname={pathname} />
      </nav>
    </div>
  );
}
