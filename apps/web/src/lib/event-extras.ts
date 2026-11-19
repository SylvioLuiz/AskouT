import type { EventExtraAnswer, EventExtraOption } from './types.ts';

/** Rascunho das respostas no formulário: id da configuração → sim/não ou texto digitado. */
export type EventExtrasDraft = Readonly<Record<string, boolean | string>>;

export const EVENT_EXTRA_TEXT_MAX = 120;

export function extrasDraftFrom(answers: readonly EventExtraAnswer[] | undefined): EventExtrasDraft {
  return Object.fromEntries((answers ?? []).map((a) => [a.optionId, a.value]));
}

/** Respostas para a API, na ordem da gestão. Texto vazio e configuração apagada ficam de fora. */
export function extrasFromDraft(draft: EventExtrasDraft, options: readonly EventExtraOption[]): EventExtraAnswer[] {
  return options.flatMap((o): EventExtraAnswer[] => {
    const value = draft[o.id];
    if (o.type === 'YES_NO') return typeof value === 'boolean' ? [{ optionId: o.id, value }] : [];
    const text = typeof value === 'string' ? value.trim() : '';
    return text ? [{ optionId: o.id, value: text }] : [];
  });
}

/** Sim/Não: tocar na resposta já marcada desmarca (volta a "não informado"). */
export function toggleYesNo(draft: EventExtrasDraft, optionId: string, value: boolean): EventExtrasDraft {
  const next: Record<string, boolean | string> = { ...draft };
  if (next[optionId] === value) delete next[optionId];
  else next[optionId] = value;
  return next;
}
