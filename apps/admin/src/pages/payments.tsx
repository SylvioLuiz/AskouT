import { useState } from 'react';
import { api } from '../api.ts';
import { useAsync } from '../hooks.ts';
import { PAYMENT_PROVIDER_LABEL, formatDateTime } from '../labels.ts';
import type { PaymentsState } from '../types.ts';
import { ActionDialog, Badge, Loadable, PageHead } from '../ui.tsx';
import type { ActionSpec } from '../ui.tsx';

function Origin({ s }: { s: PaymentsState }) {
  if (s.chosen === null) return <>Valor inicial do servidor ({s.initial ? 'ligado' : 'desligado'}). Ninguém mexeu ainda.</>;
  return <>Escolhido pelo painel{s.updatedBy ? <> por <strong>@{s.updatedBy}</strong></> : null}{s.updatedAt ? <> em {formatDateTime(s.updatedAt)}</> : null}.</>;
}

function storeNames(s: PaymentsState): string {
  const apple = s.stores?.apple ?? s.storeAvailable;
  const google = s.stores?.google ?? s.storeAvailable;
  return apple && google ? 'App Store e pelo Google Play' : apple ? 'App Store' : google ? 'Google Play' : 'loja';
}

function yesNo(on: boolean, missing: string): string {
  return on ? 'Disponível' : missing;
}

/** Escolhe quais pacotes de dias ficam à venda. O preço de cada pacote nas lojas é o cadastrado na App Store e no Google Play. */
function Packages({ s, onChange }: { s: PaymentsState; onChange: (spec: ActionSpec) => void }) {
  const all = s.packages ?? [];
  const offered = s.offeredDays ?? all.map((p) => p.days);
  const [picked, setPicked] = useState<number[]>(offered);
  const changed = picked.length !== offered.length || picked.some((d) => !offered.includes(d));
  if (all.length === 0) return null;

  function toggle(days: number) {
    setPicked((cur) => (cur.includes(days) ? cur.filter((d) => d !== days) : [...cur, days].sort((a, b) => a - b)));
  }

  function save() {
    onChange({
      title: 'Mudar os pacotes à venda',
      description: <p>Ficam à venda: {picked.map((d) => `${d} ${d === 1 ? 'dia' : 'dias'}`).join(', ')}. Vale na hora para pedidos novos; o que já foi comprado não muda.</p>,
      confirmLabel: 'Salvar pacotes',
      noteLabel: 'Motivo',
      run: (note) => api.setBoostDays(picked, note),
    });
  }

  return (
    <>
      <h2 className="section">Pacotes à venda</h2>
      <p className="muted small">
        Marque os pacotes que o app oferece. O preço que a pessoa paga no app é o cadastrado em cada produto na App Store Connect e no Google Play Console, não aqui.
      </p>
      <table className="table">
        <thead>
          <tr><th scope="col">À venda</th><th scope="col">Duração</th><th scope="col">Produto nas lojas</th></tr>
        </thead>
        <tbody>
          {all.map((p) => (
            <tr key={p.days}>
              <td><input type="checkbox" aria-label={`Vender o pacote de ${p.days} dias`} checked={picked.includes(p.days)} onChange={() => toggle(p.days)} /></td>
              <td>{p.days} {p.days === 1 ? 'dia' : 'dias'}</td>
              <td><code>{p.productId}</code></td>
            </tr>
          ))}
        </tbody>
      </table>
      {picked.length === 0 ? <p className="notice notice--warn">Deixe pelo menos um pacote à venda.</p> : null}
      <button type="button" className="btn btn--primary" onClick={save} disabled={!changed || picked.length === 0}>
        Salvar pacotes
      </button>
    </>
  );
}

export function PaymentsPage() {
  const state = useAsync(() => api.payments(), []);
  const [action, setAction] = useState<ActionSpec>();

  function turnOn(s: PaymentsState) {
    setAction({
      title: 'Ligar o pagamento do impulsionamento',
      description: (
        <>
          <p>
            A partir de agora donos de local podem comprar impulsionamento no app.
            {s.provider === 'stripe' ? <> <strong>O pagamento é real: Pix e cartão serão cobrados de verdade.</strong></> : null}
            {s.provider === 'sandbox' ? <> No site o provedor é de teste e não cobra nada.</> : null}
            {s.storeAvailable ? <> <strong>No app a cobrança é real, feita pela {storeNames(s)}.</strong></> : null}
            {s.provider === 'none' ? <> Pelo site não dá para pagar: quem estiver no site é orientado a comprar pelo app.</> : null}
          </p>
          <p className="muted small">Vale na hora, sem reiniciar nada. Você pode desligar quando quiser.</p>
        </>
      ),
      confirmLabel: 'Ligar pagamento',
      noteLabel: 'Motivo',
      run: (note) => api.setPayments(true, note),
    });
  }

  function turnOff() {
    setAction({
      title: 'Desligar o pagamento do impulsionamento',
      description: (
        <>
          <p>Ninguém consegue criar pedido novo, e o app volta a mostrar “Impulsionar chega em breve”.</p>
          <p className="muted small">Anúncios já pagos continuam no ar até o fim, e quem já pagou ainda tem o pagamento confirmado.</p>
        </>
      ),
      confirmLabel: 'Desligar pagamento',
      danger: true,
      noteLabel: 'Motivo',
      run: (note) => api.setPayments(false, note),
    });
  }

  return (
    <>
      <PageHead title="Pagamentos" hint="Liga e desliga a cobrança do impulsionamento, na hora e sem reiniciar o servidor." />
      <Loadable state={state} empty="Sem dados." isEmpty={() => false}>
        {(s) => (
          <>
            <div className="card" style={{ maxWidth: 560 }}>
              <span className="card__label">Impulsionamento pago</span>
              <p style={{ margin: '4px 0' }}>
                <Badge tone={s.enabled ? 'ok' : 'neutral'}>{s.enabled ? 'Ligado' : 'Desligado'}</Badge>
              </p>
              <p className="muted">
                {s.enabled ? 'Donos de local já podem comprar impulsionamento.' : 'Ninguém consegue comprar. O app mostra “Impulsionar chega em breve”.'}
              </p>
              <div>
                {s.enabled ? (
                  <button type="button" className="btn btn--danger" onClick={turnOff}>
                    Desligar pagamento
                  </button>
                ) : (
                  <button type="button" className="btn btn--primary" onClick={() => turnOn(s)} disabled={!s.canEnable}>
                    Ligar pagamento
                  </button>
                )}
              </div>
            </div>

            {s.blocker ? <p className="notice notice--warn" role="alert">{s.blocker} Sem isso a chave não liga.</p> : null}
            {s.enabled && s.provider === 'sandbox' ? <p className="notice notice--warn">Está ligado em modo de teste: os pedidos funcionam, mas nada é cobrado de verdade.</p> : null}
            {s.chosen === true && !s.enabled ? <p className="notice notice--warn" role="alert">Você tinha ligado, mas está desligado porque o servidor não tem como cobrar (nem loja, nem provedor na web).</p> : null}

            <h2 className="section">Situação</h2>
            <table className="table">
              <tbody>
                <tr><th scope="row">Provedor (Pix e cartão, no site)</th><td>{PAYMENT_PROVIDER_LABEL[s.provider]}</td></tr>
                <tr><th scope="row">Compra no app pela App Store (iPhone)</th><td>{yesNo(s.stores?.apple ?? s.storeAvailable, 'Não configurada: falta APPLE_APP_ID no servidor.')}</td></tr>
                <tr><th scope="row">Compra no app pelo Google Play (Android)</th><td>{yesNo(s.stores?.google ?? s.storeAvailable, 'Não configurada: falta GOOGLE_SERVICE_ACCOUNT_JSON no servidor.')}</td></tr>
                <tr><th scope="row">Como chegou neste estado</th><td><Origin s={s} /></td></tr>
              </tbody>
            </table>
            <Packages key={(s.offeredDays ?? []).join(',')} s={s} onChange={setAction} />
            <p className="muted small">Cada mudança fica na Auditoria, com quem fez e o motivo.</p>
          </>
        )}
      </Loadable>
      {action ? <ActionDialog spec={action} onClose={() => setAction(undefined)} onDone={state.reload} /> : null}
    </>
  );
}
