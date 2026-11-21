export const ROUTES = [
  { path: '/', label: 'Painel' },
  { path: '/pedidos', label: 'Pedidos de donos' },
  { path: '/denuncias', label: 'Denúncias' },
  { path: '/pessoas', label: 'Pessoas' },
  { path: '/locais', label: 'Locais' },
  { path: '/eventos', label: 'Eventos' },
  { path: '/config-eventos', label: 'Config. de eventos' },
  { path: '/gostos', label: 'Gostos' },
  { path: '/posts', label: 'Posts' },
  { path: '/feed', label: 'Feed' },
  { path: '/retencao', label: 'Retenção' },
  { path: '/convites', label: 'Convites' },
  { path: '/pagamentos', label: 'Pagamentos' },
  { path: '/hunter', label: 'Hunter' },
  { path: '/auditoria', label: 'Auditoria' },
] as const;

export type RoutePath = (typeof ROUTES)[number]['path'];

export function matchRoute(pathname: string): RoutePath {
  const clean = pathname.replace(/\/+$/, '') || '/';
  return ROUTES.find((r) => r.path === clean)?.path ?? '/';
}
