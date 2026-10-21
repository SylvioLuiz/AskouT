import type { PrismaClient } from '@prisma/client';
import type { AppSettingRecord, AppSettingsRepository } from '../../core/ports.ts';
import { isUuid } from './helpers.ts';

export class PrismaAppSettingsRepository implements AppSettingsRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async get(key: string): Promise<AppSettingRecord | undefined> {
    const row = await this.prisma.appSetting.findUnique({ where: { key } });
    return row ? { key: row.key, value: row.value, updatedAt: row.updatedAt, updatedBy: row.updatedBy } : undefined;
  }

  async set(setting: AppSettingRecord): Promise<void> {
    const updatedBy = setting.updatedBy !== null && isUuid(setting.updatedBy) ? setting.updatedBy : null;
    await this.prisma.appSetting.upsert({
      where: { key: setting.key },
      create: { key: setting.key, value: setting.value, updatedAt: setting.updatedAt, updatedBy },
      update: { value: setting.value, updatedAt: setting.updatedAt, updatedBy },
    });
  }
}
