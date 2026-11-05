import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Sheet } from './agenda.tsx';
import { MAP_APP_NAMES, mapAppLink, mapAppsFor, type MapMode, type MapTarget } from '../lib/map-links.ts';
import { t } from '../lib/i18n/index.ts';

/** Botão "ver no mapa" / "rota": pergunta em qual app abrir (Google Maps, Waze e, só em aparelho da Apple, Apple Mapas). */
export function OpenInMaps({ className, mode = 'view', children, ...target }: MapTarget & { className?: string; mode?: MapMode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  // Na rota, manda também de onde a pessoa sai: assim o Google Maps e o Apple Mapas já abrem com a rota calculada,
  // mesmo no computador. Se a posição não vier (negada ou demorando), o app de mapa usa a do aparelho.
  const [from, setFrom] = useState<{ lat: number; lng: number } | undefined>(target.from);
  function openSheet() {
    setOpen(true);
    if (mode !== 'route' || target.from || from || typeof navigator === 'undefined' || !('geolocation' in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (p) => setFrom({ lat: Math.round(p.coords.latitude * 1e5) / 1e5, lng: Math.round(p.coords.longitude * 1e5) / 1e5 }),
      () => undefined,
      { enableHighAccuracy: false, timeout: 4000, maximumAge: 5 * 60_000 },
    );
  }
  const desktop = typeof navigator !== 'undefined' && !/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const linkTarget: MapTarget = { ...target, from: target.from ?? from, desktop };
  return (
    <>
      <button type="button" className={`mapsbtn${className ? ` ${className}` : ''}`} onClick={openSheet} aria-haspopup="dialog">
        {children}
      </button>
      {open
        ? createPortal(
            <Sheet title={mode === 'route' ? t('Como chegar') : t('Abrir no mapa')} onClose={() => setOpen(false)}>
              <ul className="sharelist">
                {mapAppsFor(navigator.userAgent, navigator.platform).map((app) => (
                  <li key={app}>
                    <a className="sharelist__item" href={mapAppLink(app, linkTarget, mode)} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}>
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
