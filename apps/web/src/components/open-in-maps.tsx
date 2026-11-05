import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Sheet } from './agenda.tsx';
import { MAP_APP_NAMES, mapAppLink, mapAppsFor, type MapMode, type MapTarget } from '../lib/map-links.ts';
import { t } from '../lib/i18n/index.ts';

/** Botão "ver no mapa" / "rota": pergunta em qual app abrir (Google Maps, Waze e, só em aparelho da Apple, Apple Mapas). */
export function OpenInMaps({ className, mode = 'view', children, ...target }: MapTarget & { className?: string; mode?: MapMode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={`mapsbtn${className ? ` ${className}` : ''}`} onClick={() => setOpen(true)} aria-haspopup="dialog">
        {children}
      </button>
      {open
        ? createPortal(
            <Sheet title={mode === 'route' ? t('Como chegar') : t('Abrir no mapa')} onClose={() => setOpen(false)}>
              <ul className="sharelist">
                {mapAppsFor(navigator.userAgent, navigator.platform).map((app) => (
                  <li key={app}>
                    <a className="sharelist__item" href={mapAppLink(app, target, mode)} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}>
                      <strong>{MAP_APP_NAMES[app]}</strong>
                    </a>
                  </li>
                ))}
              </ul>
            </Sheet>,
            document.body,
          )
        : null}
    </>
  );
}
