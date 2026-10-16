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

const scrolls = new Map<string, number>();
const here = () => window.location.pathname + window.location.search;

/** Depois de trocar de tela, leva o foco ao título (leitor de tela anuncia a tela nova), sem tirar o de um campo já focado. */
function focusContent(): void {
  window.requestAnimationFrame(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && active.closest('#conteudo') && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return;
    const target = document.querySelector<HTMLElement>('#conteudo h1, #conteudo [role="heading"], #conteudo') ?? null;
    if (!target) return;
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  });
}

/** Ao voltar, devolve a rolagem que a tela tinha; o conteúdo pode chegar depois, então tenta por alguns instantes. */
function restoreScroll(top: number): void {
  const started = Date.now();
  const attempt = () => {
    window.scrollTo(0, top);
    if (Math.abs(window.scrollY - top) > 2 && Date.now() - started < 800) window.requestAnimationFrame(attempt);
  };
  window.requestAnimationFrame(attempt);
}

window.addEventListener('popstate', () => {
  const top = scrolls.get(here());
  if (top !== undefined) restoreScroll(top);
  focusContent();
});

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  scrolls.set(here(), window.scrollY);
  if (options.replace) window.history.replaceState(null, '', to);
  else window.history.pushState(null, '', to);
  window.scrollTo(0, 0);
  listeners.forEach((listener) => listener());
  focusContent();
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
