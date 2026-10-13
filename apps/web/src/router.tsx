import { useSyncExternalStore } from 'react';
import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from 'react';
import { matchPath } from './lib/route-match.ts';
import type { Params } from './lib/route-match.ts';

// Roteador mínimo sobre a History API: o app tem poucas rotas e assim não há dependência extra.

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('popstate', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', listener);
  };
}

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  if (options.replace) window.history.replaceState(null, '', to);
  else window.history.pushState(null, '', to);
  window.scrollTo(0, 0);
  listeners.forEach((listener) => listener());
}

export function usePathname(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname);
}

export function useSearch(): URLSearchParams {
  const search = useSyncExternalStore(subscribe, () => window.location.search);
  return new URLSearchParams(search);
}

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  to: string;
  children: ReactNode;
}

export function Link({ to, children, onClick, ...rest }: LinkProps) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
    if (event.defaultPrevented || event.button !== 0 || modified || rest.target === '_blank') return;
    event.preventDefault();
    navigate(to);
  }
  return (
    <a href={to} onClick={handleClick} {...rest}>
      {children}
    </a>
  );
}

export interface RouteDef {
  path: string;
  render: (params: Params) => ReactNode;
}

/** Primeira rota que casa com o caminho atual. */
export function resolveRoute(routes: RouteDef[], pathname: string): { route: RouteDef; params: Params } | undefined {
  for (const route of routes) {
    const params = matchPath(route.path, pathname);
    if (params) return { route, params };
  }
  return undefined;
}
