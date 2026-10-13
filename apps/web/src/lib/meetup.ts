import type { MeetupView } from './types.ts';

/** Nome do botão que cria o encontro. Ainda não é definitivo: mude só aqui. */
export const MEETUP_ACTION_LABEL = 'Criar encontro';
export const MEETUP_NAME_MAX = 60;

/** Quem conta como "vai": organizador e confirmados. */
export function goingLabel(m: Pick<MeetupView, 'confirmedCount' | 'invitedCount'>): string {
  const going = m.confirmedCount === 1 ? '1 confirmado' : `${m.confirmedCount} confirmados`;
  return m.invitedCount > 0 ? `${going} · ${m.invitedCount} aguardando` : going;
}

export function statusLabel(status: MeetupView['myStatus']): string | null {
  switch (status) {
    case 'ORGANIZER':
      return 'Você criou este encontro';
    case 'CONFIRMED':
      return 'Você vai';
    case 'DECLINED':
      return 'Você recusou';
    default:
      return null;
  }
}

/** Texto do grupo: "5 pessoas" / "1 pessoa". */
export function peopleLabel(count: number): string {
  return count === 1 ? '1 pessoa' : `${count} pessoas`;
}

export function toggleId(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}
