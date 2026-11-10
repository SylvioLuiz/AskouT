import { useState } from 'react';
import { api } from '../client.ts';
import { useAsync } from '../hooks.ts';
import { toApiError } from '../lib/errors.ts';
import { priceLabel, ticketStatusLabel } from '../lib/cloakroom.ts';
import type { CloakroomPublic } from '../lib/cloakroom.ts';
import { t } from '../lib/i18n/index.ts';
import { Button, Field, Notice } from './ui.tsx';

/** Chapelaria na página do evento: pedir o ticket e ver o estado dos itens (aguardando, guardado, retirado). */
export function CloakroomCard({ eventId }: { eventId: string }) {
  const loaded = useAsync<CloakroomPublic>(() => api.cloakroom(eventId), [eventId]);
  const [description, setDescription] = useState('');
  const [items, setItems] = useState('1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const view = loaded.data;
  if (!view || !view.enabled) return null;

  async function request() {
    setBusy(true);
    setError(undefined);
    try {
      await api.requestCloakroomTicket(eventId, { description, itemCount: Number(items) || 1 });
      setDescription('');
      setItems('1');
      loaded.reload();
    } catch (failure) {
      setError(toApiError(failure).message);
    } finally {
      setBusy(false);
    }
  }

  async function cancel(ticketId: string) {
    setError(undefined);
    try {
      await api.cancelCloakroomTicket(ticketId);
      loaded.reload();
    } catch (failure) {
      setError(toApiError(failure).message);
    }
  }

  return (
    <div className="evinfo__block cloak" aria-label={t('Chapelaria')}>
      <h2 className="evinfo__title">{t('Chapelaria')}</h2>
      <p className="muted">
        {priceLabel(view.priceCents)}
        {view.spotsLeft !== null ? ` · ${t('{n} vagas', { n: view.spotsLeft })}` : ''}
      </p>
      {view.note ? <p className="muted">{view.note}</p> : null}
      {view.mine.length > 0 ? (
        <ul className="cloak__list">
          {view.mine.map((ticket) => (
            <li key={ticket.id} className={`cloak__ticket cloak__ticket--${ticket.status.toLowerCase()}`}>
              <span className="cloak__code" aria-label={t('Código do ticket')}>{ticket.code}</span>
              <span className="cloak__what">
                #{ticket.number} · {ticket.description} ({ticket.itemCount})
              </span>
              <span className="cloak__status">{ticketStatusLabel(ticket.status)}</span>
              {ticket.status === 'ISSUED' ? (
                <Button small variant="quiet" onClick={() => cancel(ticket.id)}>
                  {t('Cancelar')}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {view.mine.some((x) => x.status === 'ISSUED') ? <p className="muted">{t('Mostre o código à equipe da chapelaria ao entregar seus itens.')}</p> : null}
      {view.full ? <Notice>{t('A chapelaria está lotada.')}</Notice> : null}
      {view.canRequest ? (
        <form
          className="cloak__form"
          onSubmit={(event) => {
            event.preventDefault();
            void request();
          }}
        >
          <Field label={t('O que você vai guardar')} value={description} onChange={setDescription} maxLength={80} />
          <Field label={t('Quantidade de itens')} value={items} onChange={setItems} type="number" inputMode="numeric" min="1" max="10" />
          <Button type="submit" full loading={busy} disabled={description.trim() === ''}>
            {t('Pedir ticket')}
          </Button>
        </form>
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
    </div>
  );
}
