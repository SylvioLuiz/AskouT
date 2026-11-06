import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { ListIcon, MapIcon } from './icons.tsx';
import { navigate } from '../router.tsx';
import { t } from '../lib/i18n/index.ts';

type View = 'list' | 'map';

const PATHS: Record<View, string> = { list: '/explorar', map: '/explorar/mapa' };

/**
 * Troca de visão com um crossfade curto (View Transitions, onde o navegador tiver);
 * nos outros, as telas entram com fade pelo CSS.
 */
function switchView(path: string) {
  const go = () => navigate(path, { replace: true });
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const doc = document as Document & { startViewTransition?: (update: () => void) => unknown };
  if (!doc.startViewTransition || reduce) {
    go();
    return;
  }
  document.documentElement.classList.add('vt-explore');
  const transition = doc.startViewTransition(() => flushSync(go)) as { finished?: Promise<void> };
  void transition.finished?.finally(() => document.documentElement.classList.remove('vt-explore'));
}

/**
 * Abas do topo do Explorar: a visão padrão (lista) e a visão mapa.
 * Trocar de aba substitui a entrada do histórico, para o "voltar" do aparelho
 * sair do Explorar em vez de alternar entre as duas visões.
 */
export function ExploreViews({ current, floating = false }: { current: View; floating?: boolean }) {
  const views: { id: View; label: string; icon: ReactNode }[] = [
    { id: 'list', label: t('Lista'), icon: <ListIcon /> },
    { id: 'map', label: t('Mapa'), icon: <MapIcon /> },
  ];
  return (
    <div className={`viewtabs${floating ? ' viewtabs--floating' : ''}`} role="tablist" aria-label={t('Visualização do Explorar')}>
      {views.map((view) => (
        <a
          key={view.id}
          href={PATHS[view.id]}
          role="tab"
          aria-selected={current === view.id}
          className="viewtabs__tab"
          onClick={(event) => {
            const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
            if (event.button !== 0 || modified) return;
            event.preventDefault();
            if (current !== view.id) switchView(PATHS[view.id]);
          }}
        >
          {view.icon}
          {view.label}
        </a>
      ))}
    </div>
  );
}
