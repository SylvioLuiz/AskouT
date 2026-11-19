import { useEffect, useState } from 'react';
import { api } from '../client.ts';
import { useAsync } from '../hooks.ts';
import { offerIsLive, offerUntil } from '../lib/offer.ts';
import { Link } from '../router.tsx';
import { t } from '../lib/i18n/index.ts';

/**
 * Oferta relâmpago de um bar perto de você (Home e NOW). Sempre “Patrocinado”.
 * Não aparece sem oferta, e some sozinha ao vencer. Falha ao carregar = simplesmente não mostra nada.
 */
export function OfferBanner({ reloadKey }: { reloadKey?: string | number }) {
  const offers = useAsync(() => api.nearbyOffers(), [reloadKey]);
  const [now, setNow] = useState(() => new Date());
  const offer = offers.data?.items[0];

  useEffect(() => {
    if (!offer) return undefined;
    const wait = Math.max(1000, Math.min(Date.parse(offer.endsAt) - Date.now() + 500, 60_000));
    const timer = window.setTimeout(() => setNow(new Date()), wait);
    return () => window.clearTimeout(timer);
  }, [offer?.id, now]);

  if (!offer || !offerIsLive(offer, now)) return null;
  return (
    <Link to={`/bares/${encodeURIComponent(offer.venueId)}`} className="offerbanner" aria-label={t('Oferta de {venue}: {text}, {until}', { venue: offer.venueName, text: offer.text, until: offerUntil(offer.endsAt) })}>
      <span className="tag-sponsored">{t('Patrocinado')}</span>
      <strong className="offerbanner__text">{offer.text}</strong>
      <span className="offerbanner__meta">{offer.venueName} · {offerUntil(offer.endsAt)}</span>
    </Link>
  );
}
