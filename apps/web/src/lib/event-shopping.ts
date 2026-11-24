import { documentType, fileProblem } from './chat-file.ts';
import { t } from './i18n/index.ts';
import type { EventShoppingView } from './types.ts';

/** Anexo da divisão: foto (o app reduz antes de enviar) ou documento até 10 MB (o mesmo teto da API). */
export const EXPENSE_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const EXPENSE_ACCEPT = 'image/jpeg,image/png,image/webp,.pdf,application/pdf,.xlsx,.xls,.csv,.doc,.docx,.txt';
/** Maior valor de um gasto (R$ 1.000.000,00), igual ao da API. */
export const EXPENSE_AMOUNT_MAX_CENTS = 100_000_000;

/** "R$ 1.234,56" (sempre em reais, o app é do Brasil). */
export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * Valor digitado → centavos. Aceita "12", "12,5", "12,50", "1.234,56", "R$ 10" e também "12.50" (ponto como decimal
 * quando vem com 1 ou 2 casas). `undefined`: não é um valor válido.
 */
export function parseMoney(input: string): number | undefined {
  let s = input.replace(/R\$/i, '').replace(/\s/g, '');
  if (s === '') return undefined;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return undefined;
  const cents = Math.round(Number(s) * 100);
  return cents >= 1 && cents <= EXPENSE_AMOUNT_MAX_CENTS ? cents : undefined;
}

/** Centavos → texto para o campo de valor ("12,50"). */
export function centsToInput(cents: number | null): string {
  return cents === null ? '' : (cents / 100).toFixed(2).replace('.', ',');
}

/** Tipo do anexo ou o problema dele. Fotos passam (o app reduz); documentos seguem os tipos da conversa, até 10 MB. */
export function expenseFileCheck(file: { name: string; type: string; size: number }): { kind: 'IMAGE' | 'DOCUMENT'; type: string } | { problem: string } {
  const base = file.type.split(';')[0]!.trim().toLowerCase();
  if (base === 'image/jpeg' || base === 'image/png' || base === 'image/webp' || base === 'image/heic' || base === 'image/heif') return { kind: 'IMAGE', type: base };
  const problem = fileProblem(file);
  if (problem) return { problem: t('Anexe uma foto, PDF, planilha ou documento.') };
  if (file.size > EXPENSE_FILE_MAX_BYTES) return { problem: t('O arquivo passa de 10 MB.') };
  return { kind: 'DOCUMENT', type: documentType(file.name, file.type)! };
}

/** Resumo curto para o cartão do evento: "5 itens · 2 comprados". */
export function shoppingSummary(view: Pick<EventShoppingView, 'items'>): string {
  const total = view.items.length;
  if (total === 0) return t('Nenhum item ainda');
  const bought = view.items.filter((i) => i.boughtAt !== null).length;
  const items = total === 1 ? t('1 item') : t('{n} itens', { n: total });
  if (bought === 0) return items;
  return bought === 1 ? t('{items} · 1 comprado', { items }) : t('{items} · {n} comprados', { items, n: bought });
}

/** "Você recebe R$ 10,00", "Você deve R$ 5,00" ou "Você está quite". */
export function balanceLabel(cents: number, mine: boolean): string {
  const value = formatCents(Math.abs(cents));
  if (cents > 0) return mine ? t('Você recebe {value}', { value }) : t('Recebe {value}', { value });
  if (cents < 0) return mine ? t('Você deve {value}', { value }) : t('Deve {value}', { value });
  return mine ? t('Você está quite') : t('Quite');
}
