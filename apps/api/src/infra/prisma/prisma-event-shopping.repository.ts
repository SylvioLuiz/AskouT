import type { Prisma, PrismaClient } from '@prisma/client';
import type { EventShoppingRepository } from '../../core/ports.ts';
import type { EventExpenseRecord, EventShoppingRecord, ShoppingItemRecord } from '../../core/types.ts';
import { isUuid } from './helpers.ts';

const EXPENSE_FIELDS = { id: true, eventPostId: true, uploaderId: true, fileName: true, mime: true, size: true, amountCents: true, payerId: true, note: true, createdAt: true } as const;

function ids(value: Prisma.JsonValue): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

export class PrismaEventShoppingRepository implements EventShoppingRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async get(eventPostId: string): Promise<EventShoppingRecord | undefined> {
    if (!isUuid(eventPostId)) return undefined;
    const row = await this.prisma.eventShopping.findUnique({ where: { eventPostId } });
    return row ? { eventPostId: row.eventPostId, membersCanAdd: row.membersCanAdd, membersCanCheck: row.membersCanCheck, splitExcludedIds: ids(row.splitExcludedIds), createdAt: row.createdAt } : undefined;
  }

  async upsert(record: EventShoppingRecord): Promise<boolean> {
    if (!isUuid(record.eventPostId)) return false;
    const post = await this.prisma.post.findUnique({ where: { id: record.eventPostId }, select: { eventTitle: true } });
    if (!post || post.eventTitle === null) return false;
    const data = { membersCanAdd: record.membersCanAdd, membersCanCheck: record.membersCanCheck, splitExcludedIds: record.splitExcludedIds };
    await this.prisma.eventShopping.upsert({ where: { eventPostId: record.eventPostId }, create: { eventPostId: record.eventPostId, createdAt: record.createdAt, ...data }, update: data });
    return true;
  }

  async remove(eventPostId: string): Promise<boolean> {
    if (!isUuid(eventPostId)) return false;
    const result = await this.prisma.eventShopping.deleteMany({ where: { eventPostId } });
    return result.count > 0;
  }

  async listItems(eventPostId: string): Promise<ShoppingItemRecord[]> {
    if (!isUuid(eventPostId)) return [];
    return this.prisma.eventShoppingItem.findMany({ where: { eventPostId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  }

  async findItem(id: string): Promise<ShoppingItemRecord | undefined> {
    if (!isUuid(id)) return undefined;
    return (await this.prisma.eventShoppingItem.findUnique({ where: { id } })) ?? undefined;
  }

  async addItem(item: ShoppingItemRecord): Promise<void> {
    await this.prisma.eventShoppingItem.create({ data: item });
  }

  async updateItem(id: string, patch: Partial<Pick<ShoppingItemRecord, 'title' | 'quantity' | 'boughtById' | 'boughtAt'>>): Promise<boolean> {
    if (!isUuid(id)) return false;
    const result = await this.prisma.eventShoppingItem.updateMany({ where: { id }, data: patch });
    return result.count > 0;
  }

  async deleteItem(id: string): Promise<boolean> {
    if (!isUuid(id)) return false;
    const result = await this.prisma.eventShoppingItem.deleteMany({ where: { id } });
    return result.count > 0;
  }

  async listExpenses(eventPostId: string): Promise<EventExpenseRecord[]> {
    if (!isUuid(eventPostId)) return [];
    return this.prisma.eventExpense.findMany({ where: { eventPostId }, select: EXPENSE_FIELDS, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  }

  async findExpense(id: string): Promise<EventExpenseRecord | undefined> {
    if (!isUuid(id)) return undefined;
    return (await this.prisma.eventExpense.findUnique({ where: { id }, select: EXPENSE_FIELDS })) ?? undefined;
  }

  async addExpense(expense: EventExpenseRecord, data: Uint8Array | null): Promise<void> {
    await this.prisma.eventExpense.create({ data: { ...expense, data: data ? Buffer.from(data) : null } });
  }

  async updateExpense(id: string, patch: Partial<Pick<EventExpenseRecord, 'amountCents' | 'payerId' | 'note'>>): Promise<boolean> {
    if (!isUuid(id)) return false;
    const result = await this.prisma.eventExpense.updateMany({ where: { id }, data: patch });
    return result.count > 0;
  }

  async deleteExpense(id: string): Promise<boolean> {
    if (!isUuid(id)) return false;
    const result = await this.prisma.eventExpense.deleteMany({ where: { id } });
    return result.count > 0;
  }

  async expenseFile(id: string): Promise<{ mime: string; name: string; data: Uint8Array } | undefined> {
    if (!isUuid(id)) return undefined;
    const row = await this.prisma.eventExpense.findUnique({ where: { id }, select: { mime: true, fileName: true, data: true } });
    if (!row || row.mime === null || row.fileName === null || row.data === null) return undefined;
    return { mime: row.mime, name: row.fileName, data: new Uint8Array(row.data) };
  }
}
