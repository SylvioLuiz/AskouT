import { conflict, notFound, validationError } from './errors.ts';
import type { CoreDeps } from './ports.ts';

/**
 * Configurações de evento cadastradas pela gestão ("Pode fumar?", "Estacionamento"...). Quem cria um evento responde
 * as que quiser, e a página do evento mostra ícone, nome e resposta. O catálogo fica numa chave do AppSetting (JSON),
 * lido a cada pedido: o que a gestão muda vale na hora, sem reiniciar.
 */
export const EVENT_EXTRAS_SETTING_KEY = 'event.extras';
export const EVENT_EXTRAS_MAX = 40;
export const EVENT_EXTRA_LABEL_MAX = 60;
export const EVENT_EXTRA_TEXT_MAX = 120;

/** Ícones que a gestão pode escolher. Os desenhos ficam nos apps (`apps/web/src/lib/event-extra-icons.ts`). */
export const EVENT_EXTRA_ICONS = [
  'smoking', 'car', 'parking', 'bus', 'accessibility', 'pet', 'kids', 'id', 'drink', 'food', 'music', 'wifi',
  'shirt', 'ticket', 'money', 'clock', 'pin', 'sun', 'umbrella', 'camera', 'shield', 'users', 'star', 'info',
] as const;
export type EventExtraIcon = (typeof EVENT_EXTRA_ICONS)[number];

/** `YES_NO`: a resposta é sim ou não. `TEXT`: texto livre (ex.: "na rua de trás"). */
export const EVENT_EXTRA_TYPES = ['YES_NO', 'TEXT'] as const;
export type EventExtraType = (typeof EVENT_EXTRA_TYPES)[number];

export type EventExtraOption = {
  id: string;
  icon: EventExtraIcon;
  label: string;
  type: EventExtraType;
};

/** Resposta guardada no evento. Só o id: renomear ou trocar o ícone na gestão vale para os eventos já criados. */
export type EventExtraAnswer = { optionId: string; value: boolean | string };

/** O que a página do evento mostra. */
export type EventExtraView = { optionId: string; icon: EventExtraIcon; label: string; type: EventExtraType; value: boolean | string };

export interface EventExtraInput {
  icon?: unknown;
  label?: unknown;
  type?: unknown;
}

function isOption(v: unknown): v is EventExtraOption {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o['id'] === 'string' && typeof o['label'] === 'string' && (EVENT_EXTRA_ICONS as readonly unknown[]).includes(o['icon']) && (EVENT_EXTRA_TYPES as readonly unknown[]).includes(o['type']);
}

/** Lê o catálogo guardado. Linha estragada ou ausente vira lista vazia (nunca derruba a página do evento). */
export async function loadEventExtras(deps: Pick<CoreDeps, 'settings'>): Promise<EventExtraOption[]> {
  const row = await deps.settings.get(EVENT_EXTRAS_SETTING_KEY);
  if (!row) return [];
  try {
    const parsed: unknown = JSON.parse(row.value);
    return Array.isArray(parsed) ? parsed.filter(isOption).map((o) => ({ id: o.id, icon: o.icon, label: o.label, type: o.type })) : [];
  } catch {
    return [];
  }
}

/**
 * Respostas enviadas pelo app: `[{optionId, value}]`. Configurações que não existem mais são ignoradas (o catálogo pode
 * ter mudado enquanto a pessoa preenchia); texto vazio é o mesmo que não responder.
 */
export function parseEventExtraAnswers(raw: unknown, catalog: readonly EventExtraOption[]): EventExtraAnswer[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > EVENT_EXTRAS_MAX) throw validationError('Evento inválido', { event: 'Informações extras inválidas' });
  const byId = new Map(catalog.map((o) => [o.id, o]));
  const out: EventExtraAnswer[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) throw validationError('Evento inválido', { event: 'Informações extras inválidas' });
    const { optionId, value } = item as { optionId?: unknown; value?: unknown };
    if (typeof optionId !== 'string') throw validationError('Evento inválido', { event: 'Informações extras inválidas' });
    const option = byId.get(optionId);
    if (!option || seen.has(optionId)) continue;
    if (value === undefined || value === null) continue;
    if (option.type === 'YES_NO') {
      if (typeof value !== 'boolean') throw validationError('Evento inválido', { event: `${option.label}: responda sim ou não` });
      out.push({ optionId, value });
    } else {
      if (typeof value !== 'string') throw validationError('Evento inválido', { event: `${option.label}: resposta inválida` });
      const text = value.trim().replace(/\s+/g, ' ');
      if (text === '') continue;
      if (Array.from(text).length > EVENT_EXTRA_TEXT_MAX) throw validationError('Evento inválido', { event: `${option.label}: use até ${EVENT_EXTRA_TEXT_MAX} caracteres` });
      out.push({ optionId, value: text });
    }
    seen.add(optionId);
  }
  return out;
}

/** Respostas guardadas no banco (JSON), conferidas de novo ao ler. */
export function storedEventExtraAnswers(raw: unknown): EventExtraAnswer[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): EventExtraAnswer[] => {
    if (typeof item !== 'object' || item === null) return [];
    const { optionId, value } = item as { optionId?: unknown; value?: unknown };
    return typeof optionId === 'string' && (typeof value === 'boolean' || typeof value === 'string') ? [{ optionId, value }] : [];
  });
}

/** Junta as respostas com o catálogo atual, na ordem da gestão. Configuração apagada some; tipo trocado não aparece. */
export function resolveEventExtras(answers: readonly EventExtraAnswer[] | undefined, catalog: readonly EventExtraOption[]): EventExtraView[] {
  if (!answers || answers.length === 0) return [];
  const byId = new Map(answers.map((a) => [a.optionId, a.value]));
  return catalog.flatMap((o): EventExtraView[] => {
    const value = byId.get(o.id);
    if (value === undefined) return [];
    if (o.type === 'YES_NO' ? typeof value !== 'boolean' : typeof value !== 'string') return [];
    return [{ optionId: o.id, icon: o.icon, label: o.label, type: o.type, value }];
  });
}

function parseInput(input: EventExtraInput): Omit<EventExtraOption, 'id'> {
  const fields: Record<string, string> = {};
  const icon = typeof input.icon === 'string' && (EVENT_EXTRA_ICONS as readonly string[]).includes(input.icon) ? (input.icon as EventExtraIcon) : undefined;
  if (!icon) fields['icon'] = 'Escolha um ícone da lista';
  const label = typeof input.label === 'string' ? input.label.trim().replace(/\s+/g, ' ') : '';
  if (label === '') fields['label'] = 'Dê um nome (ex.: Pode fumar?)';
  else if (Array.from(label).length > EVENT_EXTRA_LABEL_MAX) fields['label'] = `Use até ${EVENT_EXTRA_LABEL_MAX} caracteres`;
  const type = typeof input.type === 'string' && (EVENT_EXTRA_TYPES as readonly string[]).includes(input.type) ? (input.type as EventExtraType) : undefined;
  if (!type) fields['type'] = 'Escolha Sim/Não ou Texto';
  if (!icon || !type || Object.keys(fields).length > 0) throw validationError('Dados inválidos', fields);
  return { icon, label, type };
}

/** Catálogo editado pela gestão. A conferência de papel ADMIN e a auditoria ficam no AdminService. */
export class EventExtrasCatalog {
  private readonly deps: CoreDeps;

  constructor(deps: CoreDeps) {
    this.deps = deps;
  }

  list(): Promise<EventExtraOption[]> {
    return loadEventExtras(this.deps);
  }

  private async save(items: EventExtraOption[], adminId: string): Promise<EventExtraOption[]> {
    await this.deps.settings.set({ key: EVENT_EXTRAS_SETTING_KEY, value: JSON.stringify(items), updatedAt: this.deps.clock.now(), updatedBy: adminId });
    return items;
  }

  private static assertUnique(items: readonly EventExtraOption[], label: string, exceptId?: string): void {
    const key = label.toLocaleLowerCase('pt-BR');
    if (items.some((o) => o.id !== exceptId && o.label.toLocaleLowerCase('pt-BR') === key)) throw conflict('Já existe uma configuração com esse nome', { label: 'Já existe uma configuração com esse nome' });
  }

  async create(input: EventExtraInput, adminId: string): Promise<{ option: EventExtraOption; items: EventExtraOption[] }> {
    const parsed = parseInput(input);
    const items = await this.list();
    if (items.length >= EVENT_EXTRAS_MAX) throw conflict(`Dá para cadastrar até ${EVENT_EXTRAS_MAX} configurações`);
    EventExtrasCatalog.assertUnique(items, parsed.label);
    const option: EventExtraOption = { id: this.deps.ids.next(), ...parsed };
    return { option, items: await this.save([...items, option], adminId) };
  }

  async update(id: unknown, input: EventExtraInput, adminId: string): Promise<{ before: EventExtraOption; option: EventExtraOption; items: EventExtraOption[] }> {
    const parsed = parseInput(input);
    const items = await this.list();
    const before = items.find((o) => o.id === id);
    if (!before) throw notFound('Configuração não encontrada');
    EventExtrasCatalog.assertUnique(items, parsed.label, before.id);
    const option: EventExtraOption = { id: before.id, ...parsed };
    return { before, option, items: await this.save(items.map((o) => (o.id === before.id ? option : o)), adminId) };
  }

  async remove(id: unknown, adminId: string): Promise<{ option: EventExtraOption; items: EventExtraOption[] }> {
    const items = await this.list();
    const option = items.find((o) => o.id === id);
    if (!option) throw notFound('Configuração não encontrada');
    return { option, items: await this.save(items.filter((o) => o.id !== option.id), adminId) };
  }

  /** Sobe (`up`) ou desce (`down`) uma posição: é a ordem em que aparecem na criação e na página do evento. */
  async move(id: unknown, direction: unknown, adminId: string): Promise<{ option: EventExtraOption; items: EventExtraOption[] }> {
    if (direction !== 'up' && direction !== 'down') throw validationError('Dados inválidos', { direction: 'Use up ou down' });
    const items = await this.list();
    const index = items.findIndex((o) => o.id === id);
    const option = items[index];
    if (!option) throw notFound('Configuração não encontrada');
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= items.length) return { option, items };
    const next = [...items];
    next[index] = next[target] as EventExtraOption;
    next[target] = option;
    return { option, items: await this.save(next, adminId) };
  }
}
