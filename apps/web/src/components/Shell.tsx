import type { ReactNode } from 'react';
import { useUser } from '../auth.tsx';
import { api } from '../client.ts';
import { useAsync } from '../hooks.ts';
import { Link, usePathname } from '../router.tsx';
import { BellIcon, CalendarIcon, ChatIcon, HomeIcon, SearchIcon, UserIcon } from './icons.tsx';
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
  const hasPending = (pending.data?.total ?? 0) > 0;

  const activities: NavItem = { to: '/atividades', label: 'Atividades', icon: <BellIcon /> };
  const profile: NavItem = {
    to: '/perfil',
    label: 'Perfil',
    icon: <UserIcon />,
    also: ['/amigos', '/bloqueados'],
  };

  return (
    <div className="shell">
      <a className="skip" href="#conteudo">
        Ir para o conteúdo
      </a>

      <aside className="rail">
        <Link to="/" className="wordmark" aria-label="AskouT, ir para a Home">
          AskouT
        </Link>
        <nav className="rail__nav" aria-label="Principal">
          {MAIN.map((item) => (
            <NavLink key={item.to} item={item} pathname={pathname} />
          ))}
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
        {MAIN.map((item) => (
          <NavLink key={item.to} item={item} pathname={pathname} />
        ))}
      </nav>
    </div>
  );
}
