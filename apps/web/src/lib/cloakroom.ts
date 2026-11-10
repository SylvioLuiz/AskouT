import { t } from './i18n/index.ts';
import { formatBrl } from './boost.ts';

export type CloakroomStatus = 'ISSUED' | 'STORED' | 'RETURNED' | 'CANCELED';

export interface CloakroomTicket {
  id: string;
  number: number;
  code: string;
  description: string;
  itemCount: number;
  status: CloakroomStatus;
  createdAt: string;
  storedAt: string | null;
  returnedAt: string | null;
}

export interface CloakroomStaffTicket extends CloakroomTicket {
  owner: { userId: string; username: string; displayName: string; avatarUrl: string | null } | null;
}

export interface CloakroomPublic {
  enabled: boolean;
  priceCents: number | null;
  capacity: number | null;
  note: string | null;
  full: boolean;
  spotsLeft: number | null;
  canRequest: boolean;
  mine: CloakroomTicket[];
}

export interface CloakroomSetting {
  enabled: boolean;
  priceCents: number | null;
  capacity: number | null;
  note: string | null;
}

export interface CloakroomPanel {
  event: { id: string; title: string; startsAt: string; endsAt: string };
  setting: CloakroomSetting;
  stats: { waiting: number; stored: number; returned: number; itemsInUse: number; capacity: number | null };
  tickets: CloakroomStaffTicket[];
}

export interface CloakroomSettingBody {
  enabled: boolean;
  priceCents: number | null;
  capacity: number | null;
  note: string | null;
}

export function ticketStatusLabel(status: CloakroomStatus): string {
  switch (status) {
    case 'ISSUED':
      return t('Aguardando entrega');
    case 'STORED':
      return t('Guardado');
    case 'RETURNED':
      return t('Retirado');
    case 'CANCELED':
      return t('Cancelado');
  }
}

export function priceLabel(cents: number | null): string {
  return cents === null ? t('Grátis') : t('{price} por item', { price: formatBrl(cents) });
}

/** "12,50" ou "12.5" digitado pela pessoa → centavos; vazio vira `null` (grátis); texto inválido vira `undefined`. */
export function parsePriceInput(text: string): number | null | undefined {
  const s = text.trim().replace(',', '.');
  if (s === '') return null;
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(s)) return undefined;
  const cents = Math.round(Number(s) * 100);
  return cents === 0 ? null : cents;
}

/** Número inteiro positivo digitado; vazio vira `null` (sem limite); inválido vira `undefined`. */
export function parseLimitInput(text: string): number | null | undefined {
  const s = text.trim();
  if (s === '') return null;
  if (!/^\d{1,5}$/.test(s) || Number(s) < 1) return undefined;
  return Number(s);
}
