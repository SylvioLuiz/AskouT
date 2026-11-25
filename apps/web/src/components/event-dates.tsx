import { followStart } from '../lib/event-when.ts';
import { t } from '../lib/i18n/index.ts';
import { Button, Field } from './ui.tsx';

/** Início e fim lado a lado. O fim é opcional e dá para apagar; mudar o início leva o fim junto (mesma duração), e o fim continua editável. */
export function EventDates({ starts, ends, onStarts, onEnds }: { starts: string; ends: string; onStarts: (v: string) => void; onEnds: (v: string) => void }) {
  return (
    <div className="eventdates">
      <div className="eventdates__grid">
        <Field
          label={t('Começa')}
          type="datetime-local"
          value={starts}
          onChange={(v) => {
            onStarts(v);
            if (ends) onEnds(followStart(starts, v, ends));
          }}
        />
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

/**
 * Na edição, quando a data muda: pergunta se é um adiamento. Sim: o evento aparece como adiado, com a nova data e a de antes
 * riscada. Não: só muda a data. Nos dois casos quem vai recebe um aviso.
 */
export function PostponeQuestion({ value, onChange }: { value: boolean | undefined; onChange: (postponed: boolean) => void }) {
  return (
    <div className="evpostpone" role="group" aria-labelledby="evpostpone-q">
      <strong id="evpostpone-q">{t('A data mudou. É um adiamento?')}</strong>
      <div className="evpostpone__options">
        <button type="button" className={`evchip${value === true ? ' evchip--on' : ''}`} aria-pressed={value === true} onClick={() => onChange(true)}>
          {t('Sim, marcar como adiado')}
        </button>
        <button type="button" className={`evchip${value === false ? ' evchip--on' : ''}`} aria-pressed={value === false} onClick={() => onChange(false)}>
          {t('Não, só mudar a data')}
        </button>
      </div>
      <span className="muted">{t('Adiado aparece para quem vai com a nova data e a de antes riscada. Nos dois casos, quem vai recebe um aviso.')}</span>
    </div>
  );
}
