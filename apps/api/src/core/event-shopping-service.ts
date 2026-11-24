import { forbidden, notFound, validationError } from './errors.ts';
import type { EventPageService } from './event-page-service.ts';
import { baseMime, CHAT_FILE_TYPES, cleanFileName, parseChatFile, parseChatMedia } from './media.ts';
import type { CoreDeps } from './ports.ts';
import type { EventExpenseRecord, EventShoppingRecord, PublicProfile, ShoppingItemRecord } from './types.ts';
import { toPublicProfile } from './types.ts';

/** Quantos itens cabem na lista de um evento. */
export const SHOPPING_ITEMS_MAX = 200;
export const SHOPPING_ITEM_TITLE_MAX = 80;
export const SHOPPING_ITEM_QUANTITY_MAX = 30;
/** Quantos gastos (anexos) cabem na divisão de um evento. */
export const EXPENSES_MAX = 100;
export const EXPENSE_NOTE_MAX = 120;
/** Anexo da divisão (nota fiscal, recibo): foto até 2 MB (o app reduz antes) ou documento até 10 MB. */
export const EXPENSE_FILE_MAX_BYTES = 10 * 1024 * 1024;
/** Maior valor de um gasto: R$ 1.000.000,00. */
export const EXPENSE_AMOUNT_MAX_CENTS = 100_000_000;

export interface ShoppingSettingsView {
  membersCanAdd: boolean;
  membersCanCheck: boolean;
}

export interface ShoppingItemView {
  id: string;
  title: string;
  quantity: string | null;
  createdBy: PublicProfile | null;
  boughtBy: PublicProfile | null;
  boughtAt: string | null;
  /** Posso editar o texto ou apagar (quem administra ou quem criou o item). */
  canEdit: boolean;
}

export interface ExpenseView {
  id: string;
  uploader: PublicProfile | null;
  fileName: string | null;
  mime: string | null;
  size: number;
  amountCents: number | null;
  payer: PublicProfile | null;
  note: string | null;
  createdAt: string;
  /** Posso apagar: quem administra, ou quem anexou enquanto ainda não tem valor. */
  canDelete: boolean;
}

export interface SplitPersonView {
  user: PublicProfile;
  /** Entra na divisão (quem só pagou e saiu do grupo aparece com `included: false`). */
  included: boolean;
  paidCents: number;
  shareCents: number;
  /** Positivo: tem a receber. Negativo: deve. */
  balanceCents: number;
}

export interface SplitTransferView {
  from: PublicProfile;
  to: PublicProfile;
  amountCents: number;
}

export interface SplitView {
  totalCents: number;
  /** Gastos ainda sem valor ou sem quem pagou (não entram na conta). */
  pendingCount: number;
  people: SplitPersonView[];
  /** Quem paga quanto para quem, no menor número de transferências que a conta simples encontra. */
  transfers: SplitTransferView[];
}

/** O que quem abre o evento vê da lista de compras e da divisão. */
export interface EventShoppingView {
  /** Evento criado por uma pessoa (evento de local nunca tem lista). */
  supported: boolean;
  enabled: boolean;
  /** Quem criou o evento: liga e desliga. */
  isOwner: boolean;
  /** Quem criou o evento ou administra o grupo dele: muda as permissões, os valores e a divisão. */
  isAdmin: boolean;
  /** Está no grupo do evento (ou criou o evento): vê e usa a lista. */
  isMember: boolean;
  /** O evento já tem grupo (sem grupo, só quem criou usa a lista). */
  hasGroup: boolean;
  settings: ShoppingSettingsView | null;
  canAdd: boolean;
  canCheck: boolean;
  items: ShoppingItemView[];
  expenses: ExpenseView[];
  split: SplitView | null;
}

export interface ShoppingConfigInput {
  enabled?: unknown;
  membersCanAdd?: unknown;
  membersCanCheck?: unknown;
}

interface Context {
  eventPostId: string;
  ownerId: string;
  /** Quem participa: quem criou e quem está no grupo do evento, na ordem de entrada. */
  memberIds: string[];
  adminIds: Set<string>;
  hasGroup: boolean;
  record: EventShoppingRecord | undefined;
}

function text(value: unknown, max: number, field: string, label: string, required: boolean): string | null {
  if (value === undefined || value === null) {
    if (required) throw validationError('Dados inválidos', { [field]: `Informe ${label}` });
    return null;
  }
  if (typeof value !== 'string') throw validationError('Dados inválidos', { [field]: `${label} inválido` });
  const clean = value.replace(/\s+/g, ' ').trim();
  if (clean === '') {
    if (required) throw validationError('Dados inválidos', { [field]: `Informe ${label}` });
    return null;
  }
  if (Array.from(clean).length > max) throw validationError('Dados inválidos', { [field]: `Use até ${max} letras` });
  return clean;
}

function parseAmount(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > EXPENSE_AMOUNT_MAX_CENTS) {
    throw validationError('Dados inválidos', { amountCents: 'Valor inválido: use centavos, de 1 a 100000000' });
  }
  return value;
}

/** Anexo da divisão: foto (JPEG, PNG, WebP) ou documento (PDF, planilha, texto...). Confere tipo e primeiros bytes. */
export function parseExpenseFile(mimeInput: unknown, bytes: unknown, nameInput: unknown): { mime: string; name: string; data: Uint8Array } {
  const mime = baseMime(mimeInput);
  if (mime.startsWith('image/')) {
    const media = parseChatMedia(mime, bytes);
    if (media.kind !== 'IMAGE') throw validationError('Envie uma foto ou um PDF', { file: 'Envie uma foto ou um PDF' });
    const ext = mime === 'image/png' ? '.png' : mime === 'image/webp' ? '.webp' : '.jpg';
    const name = typeof nameInput === 'string' && nameInput.trim() !== '' ? cleanFileName(nameInput) : `foto${ext}`;
    return { mime, name, data: media.data };
  }
  if (!CHAT_FILE_TYPES[mime]) throw validationError('Envie uma foto ou um PDF', { file: 'Envie uma foto, PDF, planilha ou documento' });
  if (bytes instanceof Uint8Array && bytes.length > EXPENSE_FILE_MAX_BYTES) throw validationError('O arquivo passa de 10 MB', { file: 'O arquivo passa de 10 MB' });
  return parseChatFile(mime, bytes, nameInput);
}

/**
 * Divide o total por igual entre quem entra na divisão. Os centavos que sobram vão, um a um, para os primeiros da lista.
 * Devolve saldo de cada pessoa (pagou − parte) e as transferências: quem mais deve paga para quem mais tem a receber.
 */
export function computeSplit(includedIds: string[], expenses: { amountCents: number | null; payerId: string | null }[]): {
  totalCents: number;
  paid: Map<string, number>;
  share: Map<string, number>;
  transfers: { from: string; to: string; amountCents: number }[];
} {
  const paid = new Map<string, number>();
  let total = 0;
  for (const e of expenses) {
    if (e.amountCents === null || e.payerId === null) continue;
    total += e.amountCents;
    paid.set(e.payerId, (paid.get(e.payerId) ?? 0) + e.amountCents);
  }
  const share = new Map<string, number>();
  const n = includedIds.length;
  if (n > 0) {
    const base = Math.floor(total / n);
    const extra = total - base * n;
    includedIds.forEach((id, index) => share.set(id, base + (index < extra ? 1 : 0)));
  }
  const ids = [...new Set([...includedIds, ...paid.keys()])];
  const balances = ids.map((id) => ({ id, balance: (paid.get(id) ?? 0) - (share.get(id) ?? 0) }));
  const debtors = balances.filter((b) => b.balance < 0).map((b) => ({ ...b, balance: -b.balance })).sort((a, b) => b.balance - a.balance);
  const creditors = balances.filter((b) => b.balance > 0).sort((a, b) => b.balance - a.balance);
  const transfers: { from: string; to: string; amountCents: number }[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const d = debtors[i]!;
    const c = creditors[j]!;
    const amount = Math.min(d.balance, c.balance);
    if (amount > 0) transfers.push({ from: d.id, to: c.id, amountCents: amount });
    d.balance -= amount;
    c.balance -= amount;
    if (d.balance === 0) i++;
    if (c.balance === 0) j++;
  }
  return { totalCents: total, paid, share, transfers };
}

/**
 * Lista de compras e divisão de gastos dos eventos criados por pessoas (evento de local nunca tem). Quem criou o evento
 * liga; quem está no grupo do evento participa. A lista: quem administra sempre cria e marca itens, e decide se os
 * outros também podem. A divisão (para depois do evento): qualquer participante anexa a nota fiscal ou o recibo; quem
 * administra informa o valor e quem pagou; o total é dividido por igual entre quem entra na divisão.
 */
export class EventShoppingService {
  private readonly deps: CoreDeps;
  private readonly events: EventPageService;

  constructor(deps: CoreDeps, events: EventPageService) {
    this.deps = deps;
    this.events = events;
  }

  /** O evento que a pessoa pode abrir, quem participa e quem administra. Evento de local: `undefined`. */
  private async context(viewerId: string, rawId: unknown): Promise<Context | undefined> {
    const { ref, moderatorId } = await this.events.access(viewerId, rawId);
    if (ref.source !== 'USER' || moderatorId === null) return undefined;
    const { conversations } = this.deps;
    const memberIds: string[] = [moderatorId];
    const adminIds = new Set<string>([moderatorId]);
    const groupIds = await conversations.groupIdsForEventPost(ref.id);
    let hasGroup = false;
    for (const groupId of groupIds) {
      const conversation = await conversations.findById(groupId);
      if (conversation?.type !== 'GROUP') continue;
      const participants = (await conversations.participantIds(groupId)) ?? [];
      hasGroup = true;
      for (const id of participants) if (!memberIds.includes(id)) memberIds.push(id);
      const admins = await conversations.adminIds(groupId);
      for (const id of participants) if (id === conversation.ownerId || admins.includes(id)) adminIds.add(id);
    }
    return { eventPostId: ref.id, ownerId: moderatorId, memberIds, adminIds, hasGroup, record: await this.deps.eventShopping.get(ref.id) };
  }

  /** Participante de um evento com a lista ligada. */
  private async member(viewerId: string, rawId: unknown): Promise<Context & { record: EventShoppingRecord }> {
    const c = await this.context(viewerId, rawId);
    if (!c) throw notFound('A lista de compras só existe em eventos particulares');
    if (!c.memberIds.includes(viewerId)) throw forbidden('Só quem está no grupo do evento usa a lista de compras');
    if (!c.record) throw notFound('Este evento não tem lista de compras');
    return c as Context & { record: EventShoppingRecord };
  }

  private async admin(viewerId: string, rawId: unknown): Promise<Context & { record: EventShoppingRecord }> {
    const c = await this.member(viewerId, rawId);
    if (!c.adminIds.has(viewerId)) throw forbidden('Só quem administra o evento faz isso');
    return c;
  }

  private static canAdd(c: Context, viewerId: string): boolean {
    return c.record !== undefined && c.memberIds.includes(viewerId) && (c.adminIds.has(viewerId) || c.record.membersCanAdd);
  }

  private static canCheck(c: Context, viewerId: string): boolean {
    return c.record !== undefined && c.memberIds.includes(viewerId) && (c.adminIds.has(viewerId) || c.record.membersCanCheck);
  }

  async get(viewerId: string, rawId: unknown): Promise<EventShoppingView> {
    const c = await this.context(viewerId, rawId);
    if (!c) return { supported: false, enabled: false, isOwner: false, isAdmin: false, isMember: false, hasGroup: false, settings: null, canAdd: false, canCheck: false, items: [], expenses: [], split: null };
    return this.view(viewerId, c);
  }

  private async view(viewerId: string, c: Context): Promise<EventShoppingView> {
    const isMember = c.memberIds.includes(viewerId);
    const isAdmin = c.adminIds.has(viewerId);
    const base = { supported: true, isOwner: c.ownerId === viewerId, isAdmin, isMember, hasGroup: c.hasGroup };
    // Quem não está no grupo não vê nada da lista (só sabe que o evento não é dele para isso).
    if (!c.record || !isMember) return { ...base, enabled: c.record !== undefined, settings: null, canAdd: false, canCheck: false, items: [], expenses: [], split: null };
    const record = c.record;
    const { eventShopping, users, blocks } = this.deps;
    const [items, expenses, hidden] = await Promise.all([eventShopping.listItems(c.eventPostId), eventShopping.listExpenses(c.eventPostId), blocks.listRelatedIds(viewerId)]);
    const excluded = new Set(record.splitExcludedIds);
    const includedIds = c.memberIds.filter((id) => !excluded.has(id));
    const split = computeSplit(includedIds, expenses);
    const peopleIds = [...new Set([...c.memberIds, ...split.paid.keys(), ...items.flatMap((i) => [i.createdById, ...(i.boughtById ? [i.boughtById] : [])]), ...expenses.flatMap((e) => [e.uploaderId, ...(e.payerId ? [e.payerId] : [])])])];
    const profiles = new Map((await users.findProfilesByIds(peopleIds)).map((p) => [p.userId, toPublicProfile(p)] as const));
    const blockedSet = new Set(hidden);
    // Quem tem bloqueio com quem vê aparece sem nome nos itens; na conta continua contando (o dinheiro é real).
    const who = (id: string | null): PublicProfile | null => (id === null || blockedSet.has(id) ? null : profiles.get(id) ?? null);
    const accountant = (id: string): PublicProfile => profiles.get(id) ?? { userId: id, username: '', displayName: 'Conta removida', avatarUrl: null, isPrivate: true };
    const people: SplitPersonView[] = [...new Set([...includedIds, ...split.paid.keys(), ...c.memberIds])].map((id) => {
      const paid = split.paid.get(id) ?? 0;
      const share = split.share.get(id) ?? 0;
      return { user: accountant(id), included: !excluded.has(id) && c.memberIds.includes(id), paidCents: paid, shareCents: share, balanceCents: paid - share };
    });
    return {
      ...base,
      enabled: true,
      settings: { membersCanAdd: record.membersCanAdd, membersCanCheck: record.membersCanCheck },
      canAdd: EventShoppingService.canAdd(c, viewerId),
      canCheck: EventShoppingService.canCheck(c, viewerId),
      items: items.map((i) => ({
        id: i.id,
        title: i.title,
        quantity: i.quantity,
        createdBy: who(i.createdById),
        boughtBy: who(i.boughtById),
        boughtAt: i.boughtAt ? i.boughtAt.toISOString() : null,
        canEdit: isAdmin || i.createdById === viewerId,
      })),
      expenses: expenses.map((e) => ({
        id: e.id,
        uploader: who(e.uploaderId),
        fileName: e.fileName,
        mime: e.mime,
        size: e.size,
        amountCents: e.amountCents,
        payer: e.payerId ? accountant(e.payerId) : null,
        note: e.note,
        createdAt: e.createdAt.toISOString(),
        canDelete: isAdmin || (e.uploaderId === viewerId && e.amountCents === null),
      })),
      split: {
        totalCents: split.totalCents,
        pendingCount: expenses.filter((e) => e.amountCents === null || e.payerId === null).length,
        people,
        transfers: split.transfers.map((t) => ({ from: accountant(t.from), to: accountant(t.to), amountCents: t.amountCents })),
      },
    };
  }

  // ---------- Configuração ----------

  /** Quem criou o evento liga ou desliga (desligar apaga itens e gastos); quem administra muda as permissões. */
  async configure(viewerId: string, rawId: unknown, input: ShoppingConfigInput): Promise<EventShoppingView> {
    const c = await this.context(viewerId, rawId);
    if (!c) throw notFound('A lista de compras só existe em eventos particulares');
    if (!c.adminIds.has(viewerId)) throw forbidden('Só quem administra o evento configura a lista de compras');
    const flag = (value: unknown, field: string, fallback: boolean): boolean => {
      if (value === undefined) return fallback;
      if (typeof value !== 'boolean') throw validationError('Dados inválidos', { [field]: 'Use true ou false' });
      return value;
    };
    const enabled = flag(input.enabled, 'enabled', c.record !== undefined);
    if (enabled !== (c.record !== undefined) && viewerId !== c.ownerId) throw forbidden('Só quem criou o evento liga ou desliga a lista de compras');
    if (!enabled) {
      if (c.record) await this.deps.eventShopping.remove(c.eventPostId);
      return this.view(viewerId, { ...c, record: undefined });
    }
    const record: EventShoppingRecord = {
      eventPostId: c.eventPostId,
      membersCanAdd: flag(input.membersCanAdd, 'membersCanAdd', c.record?.membersCanAdd ?? true),
      membersCanCheck: flag(input.membersCanCheck, 'membersCanCheck', c.record?.membersCanCheck ?? true),
      splitExcludedIds: c.record?.splitExcludedIds ?? [],
      createdAt: c.record?.createdAt ?? this.deps.clock.now(),
    };
    if (!(await this.deps.eventShopping.upsert(record))) throw notFound('Evento não encontrado');
    return this.view(viewerId, { ...c, record });
  }

  // ---------- Lista de compras ----------

  async addItem(viewerId: string, rawId: unknown, input: { title?: unknown; quantity?: unknown }): Promise<EventShoppingView> {
    const c = await this.member(viewerId, rawId);
    if (!EventShoppingService.canAdd(c, viewerId)) throw forbidden('Quem administra o evento não liberou acrescentar itens');
    const title = text(input.title, SHOPPING_ITEM_TITLE_MAX, 'title', 'o item', true)!;
    const quantity = text(input.quantity, SHOPPING_ITEM_QUANTITY_MAX, 'quantity', 'a quantidade', false);
    if ((await this.deps.eventShopping.listItems(c.eventPostId)).length >= SHOPPING_ITEMS_MAX) throw validationError(`A lista chegou ao limite de ${SHOPPING_ITEMS_MAX} itens`);
    await this.deps.eventShopping.addItem({ id: this.deps.ids.next(), eventPostId: c.eventPostId, title, quantity, createdById: viewerId, boughtById: null, boughtAt: null, createdAt: this.deps.clock.now() });
    return this.view(viewerId, c);
  }

  private async item(c: Context, rawItemId: unknown): Promise<ShoppingItemRecord> {
    const item = typeof rawItemId === 'string' && rawItemId.length <= 64 ? await this.deps.eventShopping.findItem(rawItemId) : undefined;
    if (!item || item.eventPostId !== c.eventPostId) throw notFound('Item não encontrado');
    return item;
  }

  /** `{title?, quantity?}` muda o texto (quem administra ou quem criou); `{bought}` marca como comprado. */
  async updateItem(viewerId: string, rawId: unknown, rawItemId: unknown, input: { title?: unknown; quantity?: unknown; bought?: unknown }): Promise<EventShoppingView> {
    const c = await this.member(viewerId, rawId);
    const item = await this.item(c, rawItemId);
    const patch: Partial<Pick<ShoppingItemRecord, 'title' | 'quantity' | 'boughtById' | 'boughtAt'>> = {};
    if (input.title !== undefined || input.quantity !== undefined) {
      if (!c.adminIds.has(viewerId) && item.createdById !== viewerId) throw forbidden('Só quem criou o item ou administra o evento muda o item');
      if (input.title !== undefined) patch.title = text(input.title, SHOPPING_ITEM_TITLE_MAX, 'title', 'o item', true)!;
      if (input.quantity !== undefined) patch.quantity = text(input.quantity, SHOPPING_ITEM_QUANTITY_MAX, 'quantity', 'a quantidade', false);
    }
    if (input.bought !== undefined) {
      if (typeof input.bought !== 'boolean') throw validationError('Dados inválidos', { bought: 'Use true ou false' });
      if (!EventShoppingService.canCheck(c, viewerId)) throw forbidden('Quem administra o evento não liberou marcar itens');
      if (input.bought !== (item.boughtAt !== null)) {
        patch.boughtById = input.bought ? viewerId : null;
        patch.boughtAt = input.bought ? this.deps.clock.now() : null;
      }
    }
    if (Object.keys(patch).length > 0) await this.deps.eventShopping.updateItem(item.id, patch);
    return this.view(viewerId, c);
  }

  async deleteItem(viewerId: string, rawId: unknown, rawItemId: unknown): Promise<EventShoppingView> {
    const c = await this.member(viewerId, rawId);
    const item = await this.item(c, rawItemId);
    if (!c.adminIds.has(viewerId) && item.createdById !== viewerId) throw forbidden('Só quem criou o item ou administra o evento apaga o item');
    await this.deps.eventShopping.deleteItem(item.id);
    return this.view(viewerId, c);
  }

  // ---------- Divisão de gastos ----------

  private async checkExpenseRoom(c: Context): Promise<void> {
    if ((await this.deps.eventShopping.listExpenses(c.eventPostId)).length >= EXPENSES_MAX) throw validationError(`A divisão chegou ao limite de ${EXPENSES_MAX} gastos`);
  }

  /** Qualquer participante anexa uma nota fiscal ou recibo (foto ou documento). Quem administra pode já dizer valor e quem pagou. */
  async attach(viewerId: string, rawId: unknown, file: { mime?: unknown; data?: unknown; name?: unknown }, input: { note?: unknown; amountCents?: unknown; payerId?: unknown } = {}): Promise<EventShoppingView> {
    const c = await this.member(viewerId, rawId);
    const parsed = parseExpenseFile(file.mime, file.data, file.name);
    const note = text(input.note, EXPENSE_NOTE_MAX, 'note', 'a descrição', false);
    const { amountCents, payerId } = this.amountAndPayer(c, viewerId, input);
    await this.checkExpenseRoom(c);
    await this.deps.eventShopping.addExpense(
      { id: this.deps.ids.next(), eventPostId: c.eventPostId, uploaderId: viewerId, fileName: parsed.name, mime: parsed.mime, size: parsed.data.length, amountCents, payerId, note, createdAt: this.deps.clock.now() },
      parsed.data,
    );
    return this.view(viewerId, c);
  }

  /** Quem administra lança um gasto sem anexo (ex.: pago em dinheiro). `{amountCents, payerId, note?}` */
  async addExpense(viewerId: string, rawId: unknown, input: { note?: unknown; amountCents?: unknown; payerId?: unknown }): Promise<EventShoppingView> {
    const c = await this.admin(viewerId, rawId);
    const note = text(input.note, EXPENSE_NOTE_MAX, 'note', 'a descrição', false);
    if (input.amountCents === undefined || input.amountCents === null) throw validationError('Dados inválidos', { amountCents: 'Informe o valor' });
    if (input.payerId === undefined || input.payerId === null) throw validationError('Dados inválidos', { payerId: 'Informe quem pagou' });
    const { amountCents, payerId } = this.amountAndPayer(c, viewerId, input);
    await this.checkExpenseRoom(c);
    await this.deps.eventShopping.addExpense({ id: this.deps.ids.next(), eventPostId: c.eventPostId, uploaderId: viewerId, fileName: null, mime: null, size: 0, amountCents, payerId, note, createdAt: this.deps.clock.now() }, null);
    return this.view(viewerId, c);
  }

  /** Valor e quem pagou: só quem administra informa; quem pagou precisa estar no grupo (ou já ser quem pagou). */
  private amountAndPayer(c: Context, viewerId: string, input: { amountCents?: unknown; payerId?: unknown }, current?: EventExpenseRecord): { amountCents: number | null; payerId: string | null } {
    const touches = (input.amountCents !== undefined && input.amountCents !== null) || (input.payerId !== undefined && input.payerId !== null);
    if (touches && !c.adminIds.has(viewerId)) throw forbidden('Só quem administra o evento informa o valor e quem pagou');
    const amountCents = input.amountCents === undefined ? current?.amountCents ?? null : parseAmount(input.amountCents);
    let payerId = current?.payerId ?? null;
    if (input.payerId !== undefined) {
      if (input.payerId === null) payerId = null;
      else if (typeof input.payerId !== 'string' || !(c.memberIds.includes(input.payerId) || input.payerId === current?.payerId)) {
        throw validationError('Dados inválidos', { payerId: 'Quem pagou precisa estar no grupo do evento' });
      } else payerId = input.payerId;
    }
    return { amountCents, payerId };
  }

  private async expense(c: Context, rawExpenseId: unknown): Promise<EventExpenseRecord> {
    const expense = typeof rawExpenseId === 'string' && rawExpenseId.length <= 64 ? await this.deps.eventShopping.findExpense(rawExpenseId) : undefined;
    if (!expense || expense.eventPostId !== c.eventPostId) throw notFound('Gasto não encontrado');
    return expense;
  }

  /** Quem administra informa ou muda valor, quem pagou e a descrição. `null` limpa. */
  async updateExpense(viewerId: string, rawId: unknown, rawExpenseId: unknown, input: { note?: unknown; amountCents?: unknown; payerId?: unknown }): Promise<EventShoppingView> {
    const c = await this.admin(viewerId, rawId);
    const expense = await this.expense(c, rawExpenseId);
    const { amountCents, payerId } = this.amountAndPayer(c, viewerId, input, expense);
    const patch: Partial<Pick<EventExpenseRecord, 'amountCents' | 'payerId' | 'note'>> = { amountCents, payerId };
    if (input.note !== undefined) patch.note = text(input.note, EXPENSE_NOTE_MAX, 'note', 'a descrição', false);
    await this.deps.eventShopping.updateExpense(expense.id, patch);
    return this.view(viewerId, c);
  }

  async deleteExpense(viewerId: string, rawId: unknown, rawExpenseId: unknown): Promise<EventShoppingView> {
    const c = await this.member(viewerId, rawId);
    const expense = await this.expense(c, rawExpenseId);
    const mayDelete = c.adminIds.has(viewerId) || (expense.uploaderId === viewerId && expense.amountCents === null);
    if (!mayDelete) throw forbidden('Só quem administra o evento apaga um gasto que já tem valor');
    await this.deps.eventShopping.deleteExpense(expense.id);
    return this.view(viewerId, c);
  }

  /** O anexo de um gasto. Só quem participa baixa. */
  async expenseFile(viewerId: string, rawId: unknown, rawExpenseId: unknown): Promise<{ mime: string; name: string; data: Uint8Array }> {
    const c = await this.member(viewerId, rawId);
    const expense = await this.expense(c, rawExpenseId);
    const file = expense.fileName === null ? undefined : await this.deps.eventShopping.expenseFile(expense.id);
    if (!file) throw notFound('Este gasto não tem anexo');
    return file;
  }

  /** Quem administra põe ou tira uma pessoa da divisão (por padrão todo mundo do grupo entra). */
  async setSplitMember(viewerId: string, rawId: unknown, userId: unknown, included: unknown): Promise<EventShoppingView> {
    const c = await this.admin(viewerId, rawId);
    if (typeof included !== 'boolean') throw validationError('Dados inválidos', { included: 'Use true ou false' });
    if (typeof userId !== 'string' || !c.memberIds.includes(userId)) throw notFound('Essa pessoa não está no grupo do evento');
    const set = new Set(c.record.splitExcludedIds);
    if (included) set.delete(userId);
    else set.add(userId);
    // Guarda só quem ainda está no grupo: quem saiu já não entra na divisão.
    const record: EventShoppingRecord = { ...c.record, splitExcludedIds: [...set].filter((id) => c.memberIds.includes(id)) };
    if (record.splitExcludedIds.length >= c.memberIds.length) throw validationError('Pelo menos uma pessoa precisa entrar na divisão');
    await this.deps.eventShopping.upsert(record);
    return this.view(viewerId, { ...c, record });
  }
}
