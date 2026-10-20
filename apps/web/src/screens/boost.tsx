import { useState } from 'react';
import { Button, EmptyState, ErrorState, Loading, Notice, PageHead } from '../components/ui.tsx';
import { api } from '../client.ts';
import { useAsync, useTitle } from '../hooks.ts';
import { BOOST_PHASE_LABEL, boostTitle, boostTotalCents, canCancelBoost, daysLabel, formatBrl, sortBoosts } from '../lib/boost.ts';
import { toApiError } from '../lib/errors.ts';
import type { BoostView } from '../lib/types.ts';

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** Tela do responsável pelo local: escolhe o que impulsionar, por quantos dias, e paga por Pix. */
export function BoostScreen({ venueId }: { venueId: string }) {
  useTitle('Impulsionar');
  const back = `/bares/${encodeURIComponent(venueId)}`;
  const profile = useAsync(() => api.venueProfile(venueId), [venueId]);
  const pricing = useAsync(() => api.boostPricing(), []);
  const boosts = useAsync(() => api.venueBoosts(venueId), [venueId]);

  const [target, setTarget] = useState<string>('VENUE'); // 'VENUE' ou id do evento
  const [days, setDays] = useState<number>(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [copied, setCopied] = useState<string | undefined>(undefined);

  if (profile.loading || pricing.loading || boosts.loading) return (<><PageHead title="Impulsionar" back={back} /><Loading /></>);
  if (profile.error || pricing.error || boosts.error || !profile.data || !pricing.data || !boosts.data) {
    const e = profile.error ?? pricing.error ?? boosts.error;
    return (<><PageHead title="Impulsionar" back={back} /><ErrorState message={e?.message ?? 'Não foi possível carregar.'} onRetry={() => { profile.reload(); pricing.reload(); boosts.reload(); }} /></>);
  }
  const v = profile.data;
  if (!v.isOwner) {
    return (<><PageHead title="Impulsionar" back={back} /><EmptyState title="Só quem cuida do local pode impulsionar" /></>);
  }
  const price = pricing.data;
  const items = sortBoosts(boosts.data.items);
  const total = boostTotalCents(price.pricePerDayCents, days);

  async function run(action: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      boosts.reload();
    } catch (failure) {
      setError(toApiError(failure).message);
    } finally {
      setBusy(false);
    }
  }

  const create = () =>
    run(() => api.createBoost(venueId, target === 'VENUE' ? { target: 'VENUE', days } : { target: 'EVENT', eventId: target, days }));

  async function copy(boost: BoostView): Promise<void> {
    const code = boost.payment?.pixCode;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(boost.id);
    } catch {
      setError('Não consegui copiar. Selecione o código e copie manualmente.');
    }
  }

  return (
    <>
      <PageHead title="Impulsionar" back={back} subtitle={v.name} />
      <div className="boost">
        <p className="boost__lead">Seu rolê aparece primeiro na busca e na Home de quem segue bares como o seu, sempre com a etiqueta “Patrocinado”.</p>
        {price.sandbox ? <Notice tone="info">Modo de teste: nenhum valor é cobrado de verdade. Depois de gerar o Pix, use “Simular pagamento”.</Notice> : null}
        {error ? <Notice tone="error">{error}</Notice> : null}

        <section className="boost__block" aria-labelledby="boost-what">
          <h2 id="boost-what" className="boost__h">O que impulsionar</h2>
          <div className="boost__choices" role="radiogroup" aria-labelledby="boost-what">
            <button type="button" role="radio" aria-checked={target === 'VENUE'} className="boost__choice" onClick={() => setTarget('VENUE')}>
              <strong>O rolê (página do local)</strong>
              <span>Mostra o próximo evento do local</span>
            </button>
            {v.upcomingEvents.map((e) => (
              <button key={e.id} type="button" role="radio" aria-checked={target === e.id} className="boost__choice" onClick={() => setTarget(e.id)}>
                <strong>{e.title}</strong>
                <span>{formatWhen(e.startsAt)}</span>
              </button>
            ))}
          </div>
          {v.upcomingEvents.length === 0 ? <p className="boost__hint">Crie um evento para impulsionar só ele.</p> : null}
        </section>

        <section className="boost__block" aria-labelledby="boost-days">
          <h2 id="boost-days" className="boost__h">Por quantos dias</h2>
          <div className="optrow" role="radiogroup" aria-labelledby="boost-days">
            {price.dayOptions.map((d) => (
              <button key={d} type="button" role="radio" aria-checked={days === d} aria-pressed={days === d} className="chip" onClick={() => setDays(d)}>
                {daysLabel(d)}
              </button>
            ))}
          </div>
        </section>

        <div className="boost__total">
          <span>{formatBrl(price.pricePerDayCents)} por dia × {daysLabel(days)}</span>
          <strong>{formatBrl(total)}</strong>
        </div>
        <Button full loading={busy} onClick={() => void create()}>Gerar Pix de {formatBrl(total)}</Button>
        <p className="boost__hint">O anúncio começa assim que o pagamento for confirmado. Depois de pago, não há cancelamento.</p>

        <h2 className="boost__h">Seus impulsionamentos</h2>
        {items.length === 0 ? <p className="boost__hint">Nada por aqui ainda.</p> : null}
        <ul className="boost__list">
          {items.map((b) => (
            <li key={b.id} className="boost__item">
              <div className="boost__row">
                <strong>{boostTitle(b)}</strong>
                <span className={`boost__phase boost__phase--${b.phase.toLowerCase()}`}>{BOOST_PHASE_LABEL[b.phase]}</span>
              </div>
              <div className="boost__meta">
                {daysLabel(b.days)} · {formatBrl(b.amountCents)}
                {b.endsAt && b.phase === 'ACTIVE' ? ` · até ${formatWhen(b.endsAt)}` : ''}
              </div>
              {b.phase === 'PENDING_PAYMENT' && b.payment ? (
                <div className="boost__pay">
                  {b.payment.pixCode ? (
                    <>
                      <label className="boost__code-label" htmlFor={`pix-${b.id}`}>Pix copia e cola</label>
                      <textarea id={`pix-${b.id}`} className="boost__code" readOnly rows={3} value={b.payment.pixCode} onFocus={(e) => e.currentTarget.select()} />
                      <Button small variant="secondary" onClick={() => void copy(b)}>{copied === b.id ? 'Copiado' : 'Copiar código'}</Button>
                    </>
                  ) : null}
                  {b.payment.checkoutUrl ? <a className="btn btn--secondary btn--small" href={b.payment.checkoutUrl} target="_blank" rel="noopener noreferrer">Abrir pagamento</a> : null}
                  {price.sandbox ? <Button small loading={busy} onClick={() => void run(() => api.simulateBoostPayment(b.id))}>Simular pagamento</Button> : null}
                </div>
              ) : null}
              {canCancelBoost(b) ? <Button small variant="quiet" disabled={busy} onClick={() => void run(() => api.cancelBoost(b.id))}>Cancelar pedido</Button> : null}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
