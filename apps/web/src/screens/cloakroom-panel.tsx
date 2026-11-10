import { useState } from 'react';
import { Button, ErrorState, Field, Loading, Notice, PageHead } from '../components/ui.tsx';
import { api } from '../client.ts';
import { useAsync, useTitle } from '../hooks.ts';
import { toApiError } from '../lib/errors.ts';
import { parseLimitInput, parsePriceInput, ticketStatusLabel } from '../lib/cloakroom.ts';
import type { CloakroomPanel, CloakroomStaffTicket } from '../lib/cloakroom.ts';
import { t } from '../lib/i18n/index.ts';

function centsToInput(cents: number | null): string {
  return cents === null ? '' : (cents / 100).toFixed(2).replace('.', ',');
}

/** Painel de quem organiza: liga a chapelaria do evento, confere o código ao receber/devolver e acompanha os tickets. */
export function CloakroomPanelScreen({ venueId, eventId }: { venueId: string; eventId: string }) {
  useTitle(t('Chapelaria'));
  const loaded = useAsync<CloakroomPanel>(() => api.cloakroomPanel(venueId, eventId), [venueId, eventId]);
  const [price, setPrice] = useState<string | undefined>();
  const [limit, setLimit] = useState<string | undefined>();
  const [note, setNote] = useState<string | undefined>();
  const [code, setCode] = useState('');
  const [found, setFound] = useState<CloakroomStaffTicket | undefined>();
  const [message, setMessage] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const panel = loaded.data;
  if (loaded.loading && !panel) return <Loading />;
  if (!panel) return <ErrorState message={loaded.error?.message ?? t('Não deu certo')} onRetry={loaded.reload} />;
  const setting = panel.setting;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      await action();
    } catch (failure) {
      setError(toApiError(failure).message);
    } finally {
      setBusy(false);
    }
  }

  function save(enabled: boolean) {
    const priceCents = parsePriceInput(price ?? centsToInput(setting.priceCents));
    const capacity = parseLimitInput(limit ?? (setting.capacity === null ? '' : String(setting.capacity)));
    if (priceCents === undefined) return setError(t('Preço inválido. Use, por exemplo, 5,00.'));
    if (capacity === undefined) return setError(t('Limite inválido. Use um número inteiro ou deixe em branco.'));
    void run(async () => {
      await api.saveCloakroom(venueId, eventId, { enabled, priceCents, capacity, note: (note ?? setting.note ?? '').trim() || null });
      setPrice(undefined);
      setLimit(undefined);
      setNote(undefined);
      setMessage(enabled ? t('Chapelaria ligada.') : t('Chapelaria desligada.'));
      loaded.reload();
    });
  }

  function step(kind: 'lookup' | 'receive' | 'return') {
    void run(async () => {
      const ticket = kind === 'lookup' ? await api.cloakroomLookup(venueId, eventId, code) : kind === 'receive' ? await api.cloakroomReceive(venueId, eventId, code) : await api.cloakroomReturn(venueId, eventId, code);
      setFound(ticket);
      if (kind !== 'lookup') {
        setMessage(kind === 'receive' ? t('Itens guardados.') : t('Itens devolvidos.'));
        setCode('');
        loaded.reload();
      }
    });
  }

  return (
    <>
      <PageHead title={t('Chapelaria')} subtitle={panel.event.title} back={`/bares/${encodeURIComponent(venueId)}`} />
      <section className="cloak" aria-label={t('Configuração')}>
        <Field label={t('Preço por item (R$)')} value={price ?? centsToInput(setting.priceCents)} onChange={setPrice} inputMode="text" hint={t('Deixe em branco para grátis. A cobrança é feita na porta.')} />
        <Field label={t('Limite de itens')} value={limit ?? (setting.capacity === null ? '' : String(setting.capacity))} onChange={setLimit} inputMode="numeric" hint={t('Deixe em branco para sem limite.')} />
        <Field label={t('Aviso para o público')} value={note ?? setting.note ?? ''} onChange={setNote} maxLength={200} multiline />
        <div className="cloak__actions">
          <Button loading={busy} onClick={() => save(true)}>
            {setting.enabled ? t('Salvar') : t('Ligar chapelaria')}
          </Button>
          {setting.enabled ? (
            <Button variant="secondary" disabled={busy} onClick={() => save(false)}>
              {t('Desligar')}
            </Button>
          ) : null}
        </div>
      </section>

      {setting.enabled ? (
        <>
          <section className="cloak" aria-label={t('Números')}>
            <p>{t('{stored} guardados · {waiting} aguardando entrega · {returned} retirados', { stored: panel.stats.stored, waiting: panel.stats.waiting, returned: panel.stats.returned })}</p>
            <p className="muted">{panel.stats.capacity === null ? t('{n} itens em uso', { n: panel.stats.itemsInUse }) : t('{n} de {max} itens em uso', { n: panel.stats.itemsInUse, max: panel.stats.capacity })}</p>
          </section>

          <section className="cloak" aria-label={t('Atendimento')}>
            <Field label={t('Código do ticket')} value={code} onChange={setCode} maxLength={16} autoComplete="off" />
            <div className="cloak__actions">
              <Button small variant="secondary" disabled={busy || code.trim() === ''} onClick={() => step('lookup')}>
                {t('Consultar')}
              </Button>
              <Button small disabled={busy || code.trim() === ''} onClick={() => step('receive')}>
                {t('Receber itens')}
              </Button>
              <Button small variant="secondary" disabled={busy || code.trim() === ''} onClick={() => step('return')}>
                {t('Devolver itens')}
              </Button>
            </div>
            {found ? (
              <p className="cloak__found">
                #{found.number} · {found.owner ? `@${found.owner.username}` : ''} · {found.description} ({found.itemCount}) · <strong>{ticketStatusLabel(found.status)}</strong>
              </p>
            ) : null}
          </section>

          <ul className="cloak__list" aria-label={t('Tickets')}>
            {panel.tickets.length === 0 ? <li className="muted">{t('Nenhum ticket ainda.')}</li> : null}
            {panel.tickets.map((ticket) => (
              <li key={ticket.id} className={`cloak__ticket cloak__ticket--${ticket.status.toLowerCase()}`}>
                <span className="cloak__code">{ticket.code}</span>
                <span className="cloak__what">
                  #{ticket.number} · {ticket.owner?.displayName ?? '—'} · {ticket.description} ({ticket.itemCount})
                </span>
                <span className="cloak__status">{ticketStatusLabel(ticket.status)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {message ? <Notice tone="ok">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
    </>
  );
}
