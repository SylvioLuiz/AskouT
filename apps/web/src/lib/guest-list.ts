import { t } from './i18n/index.ts';
import { localToIso } from './post-draft.ts';
import type { GuestListConfig, GuestListView } from './types.ts';

/** Maior número de acompanhantes que o dono pode liberar (igual ao da API). */
export const GUEST_LIST_COMPANIONS_MAX = 5;

/** Linha que resume as regras da lista para quem vai entrar nela. */
export function guestListRules(config: GuestListConfig, spotsLeft: number | null, formatTime: (iso: string) => string): string {
  const parts: string[] = [];
  if (spotsLeft !== null) parts.push(spotsLeft === 0 ? t('Lista cheia') : spotsLeft === 1 ? t('1 vaga') : t('{n} vagas', { n: spotsLeft }));
  if (config.maxCompanions > 0) parts.push(config.maxCompanions === 1 ? t('até 1 acompanhante') : t('até {n} acompanhantes', { n: config.maxCompanions }));
  if (config.closesAt) parts.push(t('fecha {when}', { when: formatTime(config.closesAt) }));
  return parts.join(' · ');
}

/** O que mostrar no botão principal de quem vê a lista (nulo: nada a fazer, a lista não vale mais). */
export function guestListAction(view: GuestListView): 'join' | 'update' | null {
  if (!view.enabled) return null;
  if (view.mine) return view.open ? 'update' : null;
  return view.open ? 'join' : null;
}

export interface GuestListForm {
  limit: string;
  maxCompanions: string;
  /** Valor de <input type="datetime-local">. */
  closesAt: string;
}

/** Valida o formulário do dono. Devolve o que enviar ou o problema por campo. */
export function parseGuestListForm(form: GuestListForm): { ok: true; value: { limit: number | null; maxCompanions: number; closesAt: string | null } } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  let limit: number | null = null;
  if (form.limit.trim() !== '') {
    const n = Number(form.limit);
    if (!Number.isInteger(n) || n < 1 || n > 10_000) errors['limit'] = t('Use um número de 1 a 10000, ou deixe em branco para não ter limite.');
    else limit = n;
  }
  const companions = form.maxCompanions.trim() === '' ? 0 : Number(form.maxCompanions);
  if (!Number.isInteger(companions) || companions < 0 || companions > GUEST_LIST_COMPANIONS_MAX) errors['maxCompanions'] = t('Use um número de 0 a {max}.', { max: GUEST_LIST_COMPANIONS_MAX });
  let closesAt: string | null = null;
  if (form.closesAt.trim() !== '') {
    closesAt = localToIso(form.closesAt);
    if (!closesAt) errors['closesAt'] = t('Horário de fechamento inválido.');
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { limit, maxCompanions: companions, closesAt } };
}

/** Salva o CSV como arquivo (o texto já vem com a marca de ordem de bytes para o Excel). */
export function saveCsv(filename: string, csv: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
