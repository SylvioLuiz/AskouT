import { useState } from 'react';
import { Button } from './ui.tsx';
import { Sheet } from './agenda.tsx';
import { CALENDAR_PROVIDERS, addSynced, parseSynced, removeSynced } from '../lib/calendar-sync.ts';
import type { CalendarProvider } from '../lib/calendar-sync.ts';
import { t } from '../lib/i18n/index.ts';

const KEY = 'askout.calendarSync';

function load(): CalendarProvider[] {
  try {
    return parseSynced(window.localStorage.getItem(KEY));
  } catch {
    return [];
  }
}

function save(list: CalendarProvider[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // sem armazenamento: vale só até fechar a página
  }
}

/** Escolhe quais agendas externas ligar à do AskouT; as já ligadas ficam marcadas e podem ser desligadas. */
export function CalendarSyncSheet({ onClose, onChange }: { onClose: () => void; onChange?: (synced: CalendarProvider[]) => void }) {
  const [synced, setSynced] = useState<CalendarProvider[]>(load);
  const [picked, setPicked] = useState<CalendarProvider[]>([]);

  function update(next: CalendarProvider[]) {
    setSynced(next);
    save(next);
    onChange?.(next);
  }

  function toggle(id: CalendarProvider) {
    setPicked((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  }

  function sync() {
    update(addSynced(synced, picked));
    setPicked([]);
  }

  return (
    <Sheet title={t('Sincronizar agendas')} onClose={onClose}>
      <p className="muted">{t('Escolha de onde trazer seus compromissos para a agenda do AskouT.')}</p>
      <ul className="calsync">
        {CALENDAR_PROVIDERS.map((p) => {
          const on = synced.includes(p.id);
          const chosen = picked.includes(p.id);
          return (
            <li key={p.id} className={`calsync__item${on ? ' calsync__item--on' : ''}${chosen ? ' calsync__item--picked' : ''}`}>
              <div className="calsync__text">
                <strong>{p.name}</strong>
                <span className="muted">{on ? 'Sincronizado' : p.hint}</span>
              </div>
              {on ? (
                <>
                  <span className="calsync__badge">
                    <span aria-hidden="true">✓</span> {t('Sincronizado')}
                  </span>
                  <Button variant="quiet" small onClick={() => update(removeSynced(synced, p.id))} aria-label={t('Dessincronizar {name}', { name: p.name })}>
                    {t('Dessincronizar')}
                  </Button>
                </>
              ) : (
                <button type="button" className="calsync__pick" aria-pressed={chosen} aria-label={t('Selecionar {name}', { name: p.name })} onClick={() => toggle(p.id)}>
                  {chosen ? t('Selecionado') : t('Selecionar')}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <p className="muted calsync__note">{t('A importação dos compromissos ainda está sendo preparada. Sua escolha fica salva neste aparelho e passa a valer quando a ligação for liberada.')}</p>
      <Button full disabled={picked.length === 0} onClick={sync}>
        {picked.length > 0 ? t('Sincronizar ({length})', { length: picked.length }) : t('Sincronizar')}
      </Button>
    </Sheet>
  );
}

/** Quantas agendas já estão sincronizadas, para o botão da agenda. */
export function syncedCount(): number {
  return load().length;
}
