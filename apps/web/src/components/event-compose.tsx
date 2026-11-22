import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Sheet } from './agenda.tsx';
import { ChevronRightIcon, EventKindIcon, GlobeIcon, LockIcon } from './icons.tsx';
import { Button, Field } from './ui.tsx';
import { KINDS } from '../lib/explore.ts';
import { addHoursLocal, joinLocal, QUICK_TIMES, splitLocal, upcomingDays } from '../lib/event-when.ts';
import type { EventKind } from '../lib/types.ts';
import { t } from '../lib/i18n/index.ts';

/** Uma linha da lista "Quando / Onde / Tipo / Quem vê" da criação de evento. */
export function EventRow({ icon, label, value, placeholder, onClick, trailing, disabled }: { icon: ReactNode; label: string; value?: string | null; placeholder?: string; onClick?: () => void; trailing?: ReactNode; disabled?: boolean }) {
  const body = (
    <>
      <span className="evrow__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="evrow__label">{label}</span>
      <span className={`evrow__value${value ? '' : ' evrow__value--empty'}`}>{value || placeholder}</span>
      {onClick ? (
        <span className="evrow__chev" aria-hidden="true">
          <ChevronRightIcon />
        </span>
      ) : null}
    </>
  );
  return (
    <li className="evrow">
      {onClick ? (
        <button type="button" className="evrow__main" onClick={onClick} disabled={disabled}>
          {body}
        </button>
      ) : (
        <div className="evrow__main">{body}</div>
      )}
      {trailing}
    </li>
  );
}

/**
 * Folha "Quando": dia e hora em atalhos, com campos para qualquer outra data ou horário, e término opcional.
 * `allowPoll`: dá para deixar a data para uma votação (o evento nasce sem data e a votação decide o dia).
 */
export function EventWhenSheet({ starts, ends, dateByPoll = false, allowPoll = false, onDone, onClose }: { starts: string; ends: string; dateByPoll?: boolean; allowPoll?: boolean; onDone: (starts: string, ends: string, dateByPoll: boolean) => void; onClose: () => void }) {
  const now = useMemo(() => new Date(), []);
  const days = useMemo(() => upcomingDays(now), [now]);
  const initial = splitLocal(starts);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [end, setEnd] = useState(ends);
  const [withEnd, setWithEnd] = useState(ends !== '');
  const [byPoll, setByPoll] = useState(dateByPoll);
  const start = joinLocal(date, time);

  function addEnd() {
    setWithEnd(true);
    if (!end && start) setEnd(addHoursLocal(start, 3));
  }

  return (
    <Sheet title={t('Quando')} onClose={onClose}>
      <div className="evwhen">
        {allowPoll ? (
          <div className="evwhen__poll">
            <span className="evwhen__polltext">
              <strong id="evwhen-poll">{t('Decidir a data por votação')}</strong>
              <span className="muted">{t('O evento é criado sem data. Depois você abre a votação numa conversa e o dia escolhido vira a data do evento.')}</span>
            </span>
            <button type="button" role="switch" aria-checked={byPoll} aria-labelledby="evwhen-poll" className="switch" onClick={() => setByPoll((v) => !v)}>
              <span className="switch__thumb" />
            </button>
          </div>
        ) : null}
        {byPoll ? null : (
          <>
        <div className="evwhen__days" role="group" aria-label={t('Dia')}>
          {days.map((d) => (
            <button key={d.value} type="button" className={`evday${date === d.value ? ' evday--on' : ''}`} aria-pressed={date === d.value} aria-label={d.label} onClick={() => setDate(d.value)}>
              <span className="evday__top">{d.top}</span>
              <span className="evday__n">{d.day}</span>
            </button>
          ))}
        </div>
        <Field label={t('Outra data')} type="date" value={date} onChange={setDate} />
        <div className="evwhen__label" id="evwhen-times">
          {t('Começa às')}
        </div>
        <div className="evwhen__times" role="group" aria-labelledby="evwhen-times">
          {QUICK_TIMES.map((h) => (
            <button key={h} type="button" className={`evchip${time === h ? ' evchip--on' : ''}`} aria-pressed={time === h} onClick={() => setTime(h)}>
              {h}
            </button>
          ))}
        </div>
        <Field label={t('Outro horário')} type="time" value={time} onChange={setTime} />
        {withEnd ? (
          <div className="evwhen__end">
            <Field label={t('Termina')} type="datetime-local" value={end} onChange={setEnd} />
            <Button small variant="quiet" onClick={() => { setWithEnd(false); setEnd(''); }}>
              {t('Tirar o término')}
            </Button>
          </div>
        ) : (
          <div className="evwhen__foot">
            <button type="button" className="evlink" onClick={addEnd}>
              {t('+ Adicionar término')}
            </button>
            <span className="muted">{t('Sem término, dura 3 horas.')}</span>
          </div>
        )}
          </>
        )}
        <Button full disabled={!byPoll && !start} onClick={() => (byPoll ? onDone('', '', true) : onDone(start, withEnd ? end : '', false))}>
          {t('Pronto')}
        </Button>
      </div>
    </Sheet>
  );
}

/** Folha "Tipo": os tipos em botões com ícone, um toque escolhe e fecha. */
export function EventKindSheet({ value, onPick, onClose }: { value: EventKind; onPick: (kind: EventKind) => void; onClose: () => void }) {
  return (
    <Sheet title={t('Tipo do evento')} onClose={onClose}>
      <div className="evkinds" role="group" aria-label={t('Tipo do evento')}>
        {KINDS.map((k) => (
          <button key={k.id} type="button" className={`evkind${value === k.id ? ' evkind--on' : ''}`} aria-pressed={value === k.id} onClick={() => onPick(k.id)}>
            <EventKindIcon kind={k.id} />
            <span>{k.label}</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

/** Folha "Quem vê": público ou só quem receber nas conversas. */
export function EventAudienceSheet({ isPrivate, onPick, onClose }: { isPrivate: boolean; onPick: (isPrivate: boolean) => void; onClose: () => void }) {
  const options = [
    { value: false, icon: <GlobeIcon />, title: t('Público'), text: t('Aparece no seu perfil e no feed, e quem receber pode postar no próprio perfil.') },
    { value: true, icon: <LockIcon />, title: t('Só convidados'), text: t('Não aparece no seu perfil nem no feed. Só chega a quem receber nas conversas.') },
  ];
  return (
    <Sheet title={t('Quem vê')} onClose={onClose}>
      <ul className="evaudience">
        {options.map((o) => (
          <li key={String(o.value)}>
            <button type="button" className={`evaudience__item${isPrivate === o.value ? ' evaudience__item--on' : ''}`} aria-pressed={isPrivate === o.value} onClick={() => onPick(o.value)}>
              <span className="evaudience__icon" aria-hidden="true">
                {o.icon}
              </span>
              <span className="evaudience__text">
                <strong>{o.title}</strong>
                <span className="muted">{o.text}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="muted">{t('Depois de criar, você escolhe as conversas e grupos que vão receber o evento.')}</p>
    </Sheet>
  );
}
