import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Sheet } from './agenda.tsx';
import { Button } from './ui.tsx';
import { api } from '../client.ts';
import { findConflicts } from '../lib/going-conflict.ts';
import type { GoingTarget } from '../lib/going-conflict.ts';
import { intlLocale, t } from '../lib/i18n/index.ts';
import type { GoingEvent } from '../lib/types.ts';

/** "sex., 20/11, 22:00–03:00", na hora do aparelho. */
function whenLabel(event: Pick<GoingEvent, 'startsAt' | 'endsAt'>): string {
  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt);
  const day = start.toLocaleDateString(intlLocale(), { weekday: 'short', day: '2-digit', month: '2-digit' });
  const hm = (d: Date) => d.toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' });
  return `${day}, ${hm(start)}–${hm(end)}`;
}

/**
 * Ao tocar em "Eu vou": se já há outro evento marcado no mesmo horário, avisa e pergunta se quer marcar mesmo assim; depois,
 * mostrar o evento na aba Eventos do perfil ou deixar só na aba Participou, que só a pessoa vê.
 * `event`: o evento que está sendo marcado, para conferir o conflito. Sem ele, ou se a conferência falhar, vai direto à escolha.
 */
export function GoingChoiceSheet({ onChoose, onClose, busy, event }: { onChoose: (onProfile: boolean) => void; onClose: () => void; busy?: boolean; event?: GoingTarget }) {
  const [conflicts, setConflicts] = useState<GoingEvent[] | undefined>(event ? undefined : []);
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    if (!event) return;
    let alive = true;
    api.myGoingEvents().then(
      (r) => {
        if (alive) setConflicts(findConflicts(event, r.items));
      },
      () => {
        if (alive) setConflicts([]);
      },
    );
    return () => {
      alive = false;
    };
    // Confere uma vez, ao abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fora do cartão (o cartaz isola a pilha de camadas e pinta o texto de branco).
  if (conflicts === undefined) {
    return createPortal(
      <Sheet title={t('Conferindo sua agenda…')} onClose={onClose}>
        <p className="muted going-choice__text">{t('Só um instante.')}</p>
      </Sheet>,
      document.body,
    );
  }
  if (conflicts.length > 0 && !acknowledged) {
    return createPortal(
      <Sheet title={t('Esse horário já tem um evento')} onClose={onClose}>
        <p className="muted going-choice__text">
          {conflicts.length === 1 ? t('Você já marcou que vai em outro evento neste horário:') : t('Você já marcou que vai em outros eventos neste horário:')}
        </p>
        <ul className="going-choice__conflicts">
          {conflicts.map((c) => (
            <li key={c.id}>
              <strong>{c.title}</strong>
              <span className="muted">
                {' '}
                · {whenLabel(c)}
                {c.venueName ? ` · ${c.venueName}` : ''}
              </span>
            </li>
          ))}
        </ul>
        <div className="sheetactions">
          <Button full onClick={() => setAcknowledged(true)}>
            {t('Marcar mesmo assim')}
          </Button>
          <Button full variant="secondary" onClick={onClose}>
            {t('Cancelar')}
          </Button>
        </div>
      </Sheet>,
      document.body,
    );
  }
  return createPortal(
    <Sheet title={t('Mostrar no seu perfil?')} onClose={onClose}>
      <p className="muted going-choice__text">{t('Na aba Eventos, quem visita seu perfil vê que você vai, mas só quem pode ver o evento. Se preferir, o evento fica só na aba Participou, que só você vê.')}</p>
      <div className="sheetactions">
        <Button full loading={busy} onClick={() => onChoose(true)}>
          {t('Mostrar na aba Eventos')}
        </Button>
        <Button full variant="secondary" disabled={busy} onClick={() => onChoose(false)}>
          {t('Só para mim')}
        </Button>
      </div>
    </Sheet>,
    document.body,
  );
}
