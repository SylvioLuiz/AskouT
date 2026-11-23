import { useEffect, useRef, useState } from 'react';
import { createMapEngine, type MapEngine } from './map-engine.ts';
import { t } from '../lib/i18n/index.ts';

// Miniatura do mapa com o pin do lugar, dentro do cartão de sugestão do chat. Só é criada quando o cartão
// aparece na tela (conversa longa não abre um mapa por cartão de uma vez) e não responde a toques:
// é só para ver onde fica. Se o mapa não carregar, a miniatura some e o cartão segue sem ela.

interface Props {
  lat: number;
  lng: number;
  name: string;
}

export default function MiniPlaceMap({ lat, lng, name }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el || visible) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible || !box.current) return;
    let cancelled = false;
    let map: MapEngine | undefined;
    (async () => {
      try {
        const engine = await createMapEngine(box.current as HTMLDivElement, { center: { lat, lng }, zoom: 15, nativeZoom: false, onFail: () => setFailed(true) });
        if (cancelled) {
          engine.destroy();
          return;
        }
        map = engine;
        const pin = document.createElement('div');
        pin.className = 'pin pin--dest pin--mini';
        pin.textContent = '★';
        engine.addMarker(pin, { lat, lng }, 'center');
        engine.moveTo({ lat, lng }, { zoom: 15, animate: false });
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      map?.destroy();
    };
  }, [visible, lat, lng]);

  if (failed) return null;
  return <div ref={box} className="minimap" role="img" aria-label={t('Mapa com o local {name}', { name })} />;
}
