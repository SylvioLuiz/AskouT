import { t } from '../lib/i18n/index.ts';
import { Button, Field } from './ui.tsx';

/** Início e fim lado a lado. O fim é opcional e dá para apagar. */
export function EventDates({ starts, ends, onStarts, onEnds }: { starts: string; ends: string; onStarts: (v: string) => void; onEnds: (v: string) => void }) {
  return (
    <div className="eventdates">
      <div className="eventdates__grid">
        <Field label={t('Começa')} type="datetime-local" value={starts} onChange={onStarts} />
        <Field label={t('Termina (opcional)')} type="datetime-local" value={ends} onChange={onEnds} />
      </div>
      <div className="eventdates__foot">
        <span className="muted">{t('Sem data de fim, o evento dura 3 horas.')}</span>
        {ends ? (
          <Button small variant="quiet" onClick={() => onEnds('')}>
            {t('Apagar data final')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
