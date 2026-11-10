import { useState } from 'react';
import { Button, EmptyState, ErrorState, Field, Loading, Notice, PageHead } from '../components/ui.tsx';
import { api } from '../client.ts';
import { useAsync, useTitle } from '../hooks.ts';
import { toApiError } from '../lib/errors.ts';
import { OFFER_DURATION_CHOICES, offerDurationLabel, offerUntil } from '../lib/offer.ts';
import { t } from '../lib/i18n/index.ts';

/** Tela do responsável pelo local: publica a oferta relâmpago (“chopp em dobro até 22h”), vê a faixa de alcance e encerra. */
export function VenueOffersScreen({ venueId }: { venueId: string }) {
  useTitle(t('Oferta relâmpago'));
  const back = `/bares/${encodeURIComponent(venueId)}`;
  const profile = useAsync(() => api.venueProfile(venueId), [venueId]);
  const offers = useAsync(() => api.venueOffers(venueId), [venueId]);
  const [text, setText] = useState('');
  const [minutes, setMinutes] = useState(120);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  if (profile.loading || offers.loading) return (<><PageHead title={t('Oferta relâmpago')} back={back} /><Loading /></>);
  if (profile.error || offers.error || !profile.data || !offers.data) {
    const e = profile.error ?? offers.error;
    return (<><PageHead title={t('Oferta relâmpago')} back={back} /><ErrorState message={e?.message ?? t('Não foi possível carregar.')} onRetry={() => { profile.reload(); offers.reload(); }} /></>);
  }
  const v = profile.data;
  if (!v.isOwner) return (<><PageHead title={t('Oferta relâmpago')} back={back} /><EmptyState title={t('Só quem cuida do local pode publicar ofertas')} /></>);

  const { items, limits, remainingToday } = offers.data;
  const live = items.find((o) => o.phase === 'ACTIVE');
  const past = items.filter((o) => o.phase === 'ENDED');

  async function publish(): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      await api.createOffer(venueId, { text, minutes });
      setText('');
      offers.reload();
    } catch (failure) {
      setError(toApiError(failure).message);
    } finally {
      setBusy(false);
    }
  }

  async function end(id: string): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      await api.endOffer(id);
      offers.reload();
    } catch (failure) {
      setError(toApiError(failure).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead title={t('Oferta relâmpago')} back={back} subtitle={v.name} />
      <div className="boost">
        <p className="boost__lead">{t('Uma oferta curta para quem está perto: aparece na Home e no NOW de quem tem o NOW ligado ou a região salva a até {km} km do local, sempre com a etiqueta “Patrocinado”. Você nunca vê quem recebeu.', { km: limits.radiusKm })}</p>
        {limits.free ? <Notice tone="info">{t('Por enquanto a oferta é grátis.')}</Notice> : null}
        {error ? <Notice tone="error">{error}</Notice> : null}

        {live ? (
          <section className="boost__block" aria-labelledby="offer-live">
            <h2 id="offer-live" className="boost__h">{t('No ar agora')}</h2>
            <div className="offerbanner offerbanner--owner">
              <span className="tag-sponsored">{t('Patrocinado')}</span>
              <strong className="offerbanner__text">{live.text}</strong>
              <span className="offerbanner__meta">{offerUntil(live.endsAt)}</span>
              {live.reach ? <span className="offerbanner__meta">{t('Alcance: {label}', { label: live.reach.label })}{live.reach.partial ? t(' (estimativa: só parte da região foi examinada)') : ''}</span> : null}
            </div>
            <Button variant="secondary" loading={busy} onClick={() => void end(live.id)}>{t('Encerrar agora')}</Button>
          </section>
        ) : (
          <section className="boost__block" aria-labelledby="offer-new">
            <h2 id="offer-new" className="boost__h">{t('Nova oferta')}</h2>
            <Field label={t('Oferta')} value={text} onChange={setText} maxLength={limits.textMax} placeholder={t('Chopp em dobro até 22h')} hint={t('{n} de {max} caracteres', { n: text.length, max: limits.textMax })} />
            <div className="boost__choices" role="radiogroup" aria-label={t('Quanto tempo no ar')}>
              {OFFER_DURATION_CHOICES.filter((m) => m >= limits.minMinutes && m <= limits.maxMinutes).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={minutes === m} className="boost__choice" onClick={() => setMinutes(m)}>
                  <strong>{offerDurationLabel(m)}</strong>
                </button>
              ))}
            </div>
            <p className="boost__hint">{t('Ainda dá para publicar {n} hoje (limite de {max} por dia).', { n: remainingToday, max: limits.maxPerDay })}</p>
            <Button loading={busy} disabled={text.trim().length < limits.textMin || remainingToday === 0} onClick={() => void publish()}>{t('Publicar oferta')}</Button>
          </section>
        )}

        {past.length > 0 ? (
          <section className="boost__block" aria-labelledby="offer-past">
            <h2 id="offer-past" className="boost__h">{t('Anteriores')}</h2>
            <ul className="boost__list">
              {past.map((o) => (<li key={o.id}>{o.text} · {offerUntil(o.endsAt)}</li>))}
            </ul>
          </section>
        ) : null}
      </div>
    </>
  );
}
