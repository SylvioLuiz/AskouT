import { useEffect, useState } from 'react';
import { matchRoute } from './routes.ts';
import type { RoutePath } from './routes.ts';

export function go(path: RoutePath): void {
  if (window.location.pathname === path) return;
  window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function useRoute(): RoutePath {
  const [route, setRoute] = useState(() => matchRoute(window.location.pathname));
  useEffect(() => {
    const on = () => setRoute(matchRoute(window.location.pathname));
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  return route;
}
