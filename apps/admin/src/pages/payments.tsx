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
            {s.provider === 'stripe' ? <> <strong>O pagamento é real: Pix e cartão serão cobrados de verdade.</strong></> : <> O provedor atual é de teste e não cobra nada.</>}
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
            {s.chosen === true && !s.enabled ? <p className="notice notice--warn" role="alert">Você tinha ligado, mas está desligado porque não há provedor de pagamento configurado.</p> : null}

            <h2 className="section">Situação</h2>
            <table className="table">
              <tbody>
                <tr><th scope="row">Provedor (Pix e cartão, no site)</th><td>{PAYMENT_PROVIDER_LABEL[s.provider]}</td></tr>
                <tr><th scope="row">Compra dentro do app (App Store e Google Play)</th><td>{s.storeAvailable ? 'Disponível' : 'Ainda não disponível: falta o verificador de recibos das lojas.'}</td></tr>
                <tr><th scope="row">Como chegou neste estado</th><td><Origin s={s} /></td></tr>
              </tbody>
            </table>
            <p className="muted small">Cada mudança fica na Auditoria, com quem fez e o motivo.</p>
          </>
        )}
      </Loadable>
      {action ? <ActionDialog spec={action} onClose={() => setAction(undefined)} onDone={state.reload} /> : null}
    </>
  );
}
