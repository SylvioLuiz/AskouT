import { useEffect, useState } from 'react';
import { Button, EmptyState, ErrorState, Loading, Notice, PageHead } from '../components/ui.tsx';
import { api } from '../client.ts';
import { useAsync, useTitle } from '../hooks.ts';
import { BOOST_PHASE_LABEL, boostTitle, canCancelBoost, daysLabel, formatBrl, matchLabel, reachText, sortBoosts, toggleTag } from '../lib/boost.ts';
import { toApiError } from '../lib/errors.ts';
import { buyInStore, packageSummary, paymentReturn, purchaseChannel, safePaymentUrl, STORE_LABEL, storeBridge } from '../lib/purchase.ts';
import type { BoostView, MatchReach } from '../lib/types.ts';

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** Tela do responsável pelo local: escolhe o que impulsionar, por quantos dias, e paga (Pix/cartão no site, compra da loja no aplicativo). */
export function BoostScreen({ venueId }: { venueId: string }) {
  useTitle('Impulsionar');
  const back = `/bares/${encodeURIComponent(venueId)}`;
  const profile = useAsync(() => api.venueProfile(venueId), [venueId]);
  const pricing = useAsync(() => api.boostPricing(), []);
  const boosts = useAsync(() => api.venueBoosts(venueId), [venueId]);

  const [target, setTarget] = useState<string>('VENUE'); // 'VENUE' ou id do evento
  const [days, setDays] = useState<number>(3);
  const [audience, setAudience] = useState<'ALL' | 'MATCH'>('ALL');
  const [radiusKm, setRadiusKm] = useState<number>(5);
  const [tags, setTags] = useState<string[]>([]);
  const [reach, setReach] = useState<{ state: 'idle' | 'loading' | 'error' | 'ready'; data?: MatchReach }>({ state: 'idle' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [copied, setCopied] = useState<string | undefined>(undefined);
  const channel = purchaseChannel();
  const returned = paymentReturn(window.location.search);

  const eventTarget = target === 'VENUE' ? undefined : profile.data?.upcomingEvents.find((e) => e.id === target);
  const matching = audience === 'MATCH' && eventTarget !== undefined;

  // Estimativa de quantas pessoas combinam: só o número, depois de uma pequena pausa para não consultar a cada toque.
  useEffect(() => {
    if (!matching || !eventTarget || tags.length === 0) {
      setReach({ state: 'idle' });
      return;
    }
    let cancelled = false;
    setReach({ state: 'loading' });
    const timer = window.setTimeout(() => {
      api.matchReach(venueId, { eventId: eventTarget.id, radiusKm, tags }).then(
        (data) => { if (!cancelled) setReach({ state: 'ready', data }); },
        () => { if (!cancelled) setReach({ state: 'error' }); },
      );
    }, 350);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [matching, eventTarget?.id, radiusKm, tags.join(','), venueId]);

  // Volta da página de pagamento: o aviso do provedor pode levar alguns instantes (o Pix, alguns minutos), então confere de tempos em tempos.
  const waiting = returned === 'ok' && (boosts.data?.items.some((b) => b.phase === 'PENDING_PAYMENT') ?? false);
  useEffect(() => {
    if (!waiting) return undefined;
    const timer = window.setInterval(() => boosts.reload(), 5000);
    return () => window.clearInterval(timer);
  }, [waiting]);

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
  const onStore = channel !== 'WEB';
  const storeName = onStore ? STORE_LABEL[channel] : '';
  const { total, perDay, discountPct } = packageSummary(price, channel, days);
  // Na loja a compra precisa da casca nativa do aplicativo; sem ela o botão fica desligado e explicado.
  const storeReady = !onStore || (price.store.available && storeBridge() !== undefined);

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

  /** Compra da loja: abre o pagamento nativo e manda o recibo para o servidor conferir. */
  async function finishStorePurchase(boost: BoostView): Promise<void> {
    if (!boost.storeProductId) return;
    const receipt = await buyInStore(boost.storeProductId);
    await api.confirmStorePurchase(boost.id, receipt);
  }

  const create = () =>
    run(async () => {
      const base = target === 'VENUE' ? { target: 'VENUE' as const, days } : matching ? { target: 'EVENT' as const, eventId: target, days, audience: 'MATCH' as const, radiusKm, tags } : { target: 'EVENT' as const, eventId: target, days };
      const created = await api.createBoost(venueId, onStore ? { ...base, channel } : base);
      if (onStore) {
        await finishStorePurchase(created);
        return;
      }
      // No site: leva direto para a página de pagamento (Pix ou cartão). Sem link, o Pix aparece abaixo, no pedido.
      const url = safePaymentUrl(created.payment?.checkoutUrl);
      if (url) window.location.assign(url);
    });

  function pickTarget(id: string): void {
    setTarget(id);
    const ev = v.upcomingEvents.find((e) => e.id === id);
    setTags(ev ? ev.tags.slice(0, price.match.maxTags) : []);
    if (!ev) setAudience('ALL');
  }

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

  const listBlock = (
    <>
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
            {matchLabel(b) ? `${matchLabel(b)} · ` : ''}{daysLabel(b.days)} · {formatBrl(b.amountCents)}
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
              {safePaymentUrl(b.payment.checkoutUrl) ? <a className="btn btn--secondary btn--small" href={safePaymentUrl(b.payment.checkoutUrl)} target="_blank" rel="noopener noreferrer">Abrir pagamento</a> : null}
              {price.sandbox && b.channel === 'WEB' ? <Button small loading={busy} onClick={() => void run(() => api.simulateBoostPayment(b.id))}>Simular pagamento</Button> : null}
            </div>
          ) : null}
          {b.phase === 'PENDING_PAYMENT' && b.storeProductId && storeReady ? <Button small loading={busy} onClick={() => void run(() => finishStorePurchase(b))}>Concluir compra</Button> : null}
          {canCancelBoost(b) ? <Button small variant="quiet" disabled={busy} onClick={() => void run(() => api.cancelBoost(b.id))}>Cancelar pedido</Button> : null}
        </li>
      ))}
    </ul>
    </>
  );

  if (!price.enabled) {
    return (
      <>
        <PageHead title="Impulsionar" back={back} subtitle={v.name} />
        <div className="boost">
          <EmptyState title="Impulsionar chega em breve">Em breve você poderá destacar seu rolê e seus eventos aqui. Avisaremos quando abrir.</EmptyState>
          {items.length > 0 ? listBlock : null}
        </div>
      </>
    );
  }

  return (
    <>
      <PageHead title="Impulsionar" back={back} subtitle={v.name} />
      <div className="boost">
        <p className="boost__lead">Seu rolê aparece primeiro na busca e na Home de quem segue bares como o seu, sempre com a etiqueta “Patrocinado”.</p>
        {returned === 'ok' ? <Notice tone="ok">Pagamento enviado. Assim que for confirmado, seu impulsionamento começa. O Pix pode levar alguns minutos.</Notice> : null}
        {returned === 'cancelado' ? <Notice tone="info">O pagamento foi cancelado e nada foi cobrado. Você pode tentar de novo quando quiser.</Notice> : null}
        {price.sandbox && !onStore ? <Notice tone="info">Modo de teste: nenhum valor é cobrado de verdade. Depois de criar o pedido, use “Simular pagamento”.</Notice> : null}
        {onStore && !storeReady ? <Notice tone="info">A compra pelo aplicativo ainda não está disponível nesta versão.</Notice> : null}
        {error ? <Notice tone="error">{error}</Notice> : null}

        <section className="boost__block" aria-labelledby="boost-what">
          <h2 id="boost-what" className="boost__h">O que impulsionar</h2>
          <div className="boost__choices" role="radiogroup" aria-labelledby="boost-what">
            <button type="button" role="radio" aria-checked={target === 'VENUE'} className="boost__choice" onClick={() => pickTarget('VENUE')}>
              <strong>O rolê (página do local)</strong>
              <span>Mostra o próximo evento do local</span>
            </button>
            {v.upcomingEvents.map((e) => (
              <button key={e.id} type="button" role="radio" aria-checked={target === e.id} className="boost__choice" onClick={() => pickTarget(e.id)}>
                <strong>{e.title}</strong>
                <span>{formatWhen(e.startsAt)}</span>
              </button>
            ))}
          </div>
          {v.upcomingEvents.length === 0 ? <p className="boost__hint">Crie um evento para impulsionar só ele.</p> : null}
        </section>

        {eventTarget ? (
          <section className="boost__block" aria-labelledby="boost-who">
            <h2 id="boost-who" className="boost__h">Para quem aparece</h2>
            <div className="boost__choices" role="radiogroup" aria-labelledby="boost-who">
              <button type="button" role="radio" aria-checked={audience === 'ALL'} className="boost__choice" onClick={() => setAudience('ALL')}>
                <strong>Todos</strong>
                <span>Destaque no Explorar e na Home para qualquer pessoa</span>
              </button>
              <button type="button" role="radio" aria-checked={audience === 'MATCH'} className="boost__choice" onClick={() => setAudience('MATCH')}>
                <strong>Match</strong>
                <span>Só quem mora perto e curte esse estilo de rolê</span>
              </button>
            </div>
            {audience === 'MATCH' ? (
              <div className="boost__match">
                {eventTarget.tags.length === 0 ? (
                  <Notice tone="info">Este evento não tem hashtags. Edite o evento e adicione, por exemplo, #rock para usar o Match.</Notice>
                ) : (
                  <>
                    <h3 id="boost-radius" className="boost__sub">Raio em volta do local</h3>
                    <div className="optrow" role="radiogroup" aria-labelledby="boost-radius">
                      {price.match.radiusKmOptions.map((km) => (
                        <button key={km} type="button" role="radio" aria-checked={radiusKm === km} aria-pressed={radiusKm === km} className="chip" onClick={() => setRadiusKm(km)}>
                          {km} km
                        </button>
                      ))}
                    </div>
                    <h3 id="boost-tags" className="boost__sub">Gostos que você quer alcançar</h3>
                    <div className="optrow" role="group" aria-labelledby="boost-tags">
                      {eventTarget.tags.map((t) => (
                        <button key={t} type="button" aria-pressed={tags.includes(t)} className="chip" onClick={() => setTags((cur) => toggleTag(cur, t, price.match.maxTags))}>
                          #{t}
                        </button>
                      ))}
                    </div>
                    <p className="boost__reach" role="status" aria-live="polite">
                      {tags.length === 0 ? 'Escolha ao menos uma hashtag.' : reach.state === 'loading' ? 'Calculando o alcance…' : reach.state === 'error' ? 'Não foi possível estimar o alcance agora. Você ainda pode comprar.' : reach.state === 'ready' && reach.data ? reachText(reach.data) : ''}
                    </p>
                    <details className="boost__rule">
                      <summary>Como o Match escolhe as pessoas</summary>
                      <p>Vê o anúncio só quem salvou a própria região e mora até {radiusKm} km do seu local, e tem o gosto confirmado por uma das hashtags escolhidas: nos últimos 60 dias curtiu, comentou, compartilhou ou foi a pelo menos 3 conteúdos com essa hashtag, em pelo menos 2 dias diferentes, e o último foi nos últimos 30 dias.</p>
                      <p>Você vê apenas um número aproximado. Nunca vê quem são as pessoas, e quem desliga as recomendações personalizadas ou apaga a região deixa de receber.</p>
                    </details>
                  </>
                )}
              </div>
            ) : null}
          </section>
        ) : null}

        <section className="boost__block" aria-labelledby="boost-days">
          <h2 id="boost-days" className="boost__h">Por quantos dias</h2>
          <div className="optrow" role="radiogroup" aria-labelledby="boost-days">
            {price.dayOptions.map((d) => (
              <button key={d} type="button" role="radio" aria-checked={days === d} aria-pressed={days === d} className="chip" onClick={() => setDays(d)}>
                {daysLabel(d)}
                {packageSummary(price, channel, d).discountPct > 0 ? <small> −{packageSummary(price, channel, d).discountPct}%</small> : null}
              </button>
            ))}
          </div>
        </section>

        <div className="boost__total">
          <span>{formatBrl(perDay)} por dia × {daysLabel(days)}{discountPct > 0 ? ` (${discountPct}% de desconto)` : ''}</span>
          <strong>{formatBrl(total)}</strong>
        </div>
        <Button full loading={busy} disabled={!storeReady || (matching && (tags.length === 0 || eventTarget?.tags.length === 0))} onClick={() => void create()}>{onStore ? `Comprar por ${formatBrl(total)}` : `Pagar ${formatBrl(total)}`}</Button>
        <p className="boost__hint">
          {onStore ? `A compra é cobrada pela ${storeName}. ` : 'Pague com Pix ou cartão. '}O anúncio começa assim que o pagamento for confirmado. Depois de pago, não há cancelamento.
        </p>

        {listBlock}
      </div>
    </>
  );
}
