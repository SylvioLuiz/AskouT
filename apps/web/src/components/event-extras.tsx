import { useId, useState } from 'react';
import { ChevronDownIcon } from './icons.tsx';
import { eventExtraIconPaths } from '../lib/event-extra-icons.ts';
import { EVENT_EXTRA_TEXT_MAX, extrasFromDraft, toggleYesNo } from '../lib/event-extras.ts';
import type { EventExtrasDraft } from '../lib/event-extras.ts';
import type { EventExtraOption, EventExtraView } from '../lib/types.ts';
import { t } from '../lib/i18n/index.ts';

export function EventExtraIcon({ icon }: { icon: string }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {eventExtraIconPaths(icon).map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/**
 * Configurações de evento da gestão, para responder ao criar ou editar um evento. Fica recolhido (acordeon) para não
 * ocupar espaço; aberto, cada linha tem Sim/Não ou um campo de texto. Tudo é opcional.
 */
export function EventExtrasFields({ options, value, onChange, embedded = false }: { options: readonly EventExtraOption[]; value: EventExtrasDraft; onChange: (next: EventExtrasDraft) => void; /** Já dentro de outro acordeon (criar evento): só a lista, sempre aberta. */ embedded?: boolean }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  if (options.length === 0) return null;
  const answered = extrasFromDraft(value, options).length;
  const preview = options.slice(0, 3).map((o) => o.label).join(', ') + (options.length > 3 ? '…' : '');
  const list = (
        <ul className="evextras__list" id={panelId}>
          {options.map((o) => {
            const current = value[o.id];
            return (
              <li key={o.id} className={`evextras__row${o.type === 'TEXT' ? ' evextras__row--text' : ''}`}>
                <span className="evextras__icon">
                  <EventExtraIcon icon={o.icon} />
                </span>
                <span className="evextras__label" id={`${panelId}-${o.id}`}>
                  {o.label}
                </span>
                {o.type === 'YES_NO' ? (
                  <span className="evextras__yn" role="group" aria-labelledby={`${panelId}-${o.id}`}>
                    <button type="button" className={`evextras__pill${current === true ? ' evextras__pill--on' : ''}`} aria-pressed={current === true} onClick={() => onChange(toggleYesNo(value, o.id, true))}>
                      {t('Sim')}
                    </button>
                    <button type="button" className={`evextras__pill${current === false ? ' evextras__pill--on' : ''}`} aria-pressed={current === false} onClick={() => onChange(toggleYesNo(value, o.id, false))}>
                      {t('Não')}
                    </button>
                  </span>
                ) : (
                  <input
                    className="field__input evextras__input"
                    value={typeof current === 'string' ? current : ''}
                    onChange={(e) => onChange({ ...value, [o.id]: e.target.value })}
                    maxLength={EVENT_EXTRA_TEXT_MAX}
                    placeholder={t('Escreva aqui (opcional)')}
                    aria-labelledby={`${panelId}-${o.id}`}
                  />
                )}
              </li>
            );
          })}
        </ul>
  );
  if (embedded) return list;
  return (
    <div className={`evextras${open ? ' evextras--open' : ''}`}>
      <button type="button" className="evextras__head" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((o) => !o)}>
        <span className="evextras__text">
          <span className="evextras__title">{t('Mais informações do evento')}</span>
          <span className="evextras__sub">{answered > 0 ? (answered === 1 ? t('1 preenchida') : t('{count} preenchidas', { count: answered })) : preview}</span>
        </span>
        <span className="evextras__chev">
          <ChevronDownIcon />
        </span>
      </button>
      {open ? list : null}
    </div>
  );
}

/** Na página do evento: ícone, nome da configuração e resposta. */
export function EventExtrasList({ extras, compact = false }: { extras: readonly EventExtraView[]; compact?: boolean }) {
  if (extras.length === 0) return null;
  return (
    <ul className={`evextras-view${compact ? ' evextras-view--compact' : ''}`}>
      {extras.map((x) => (
        <li key={x.optionId}>
          <EventExtraIcon icon={x.icon} />
          <span className="evextras-view__label">{x.label}</span>
          <strong className="evextras-view__value">{typeof x.value === 'boolean' ? (x.value ? t('Sim') : t('Não')) : x.value}</strong>
        </li>
      ))}
    </ul>
  );
}
