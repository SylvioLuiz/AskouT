import { useEffect, useState } from 'react';
import { api } from '../client.ts';
import { safeImage } from '../lib/explore.ts';
import { t } from '../lib/i18n/index.ts';
import type { ChatVenueCard } from '../lib/types.ts';
import { Link } from '../router.tsx';
import { VenueLogo } from './venue-logo.tsx';

/** Cartão de um local dentro da conversa: capa, logo, nome e endereço. Abre a página do local no app. */
export function VenueBubble({ venue }: { venue: ChatVenueCard }) {
  const [failed, setFailed] = useState(false);
  const own = safeImage(venue.coverUrl);
  // Sem capa própria, a foto do Google (assinada) só a página do local entrega: busca lá.
  const [fetched, setFetched] = useState<string | null>(null);
  useEffect(() => {
    if (own) return;
    let cancelled = false;
    api.venueProfile(venue.id).then(
      (page) => {
        if (!cancelled && page.photoPath) setFetched(api.assetUrl(page.photoPath));
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [venue.id, own]);
  const image = failed ? null : (own ?? fetched);
  const place = venue.address ?? venue.category;
  return (
    <Link to={`/bares/${encodeURIComponent(venue.id)}`} className="evbubble vnbubble" aria-label={t('Abrir a página de {name}', { name: venue.name })}>
      <span className="evcover evcover--wide vnbubble__cover">
        {image ? <img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : null}
      </span>
      <span className="vnbubble__head">
        <VenueLogo name={venue.name} logoUrl={venue.logoUrl} size={32} />
        <strong className="evbubble__title">{venue.name}</strong>
      </span>
      {place ? <span className="evbubble__sub">{place}</span> : null}
      <span className="evbubble__cta">{t('Ver local')}</span>
    </Link>
  );
}
