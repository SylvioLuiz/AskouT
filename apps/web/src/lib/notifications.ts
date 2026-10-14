/** Avisa o resto do app (o sino) que os avisos não lidos podem ter mudado. */
export const NOTIFICATIONS_CHANGED_EVENT = 'askout:notifications-changed';
export function announceNotificationsChanged(): void {
  window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
}

/**
 * Bolinha do sino = "tem novidade desde a última vez que você abriu Atividades". Abrir a tela apaga a bolinha, mesmo
 * sem abrir cada aviso; dentro dela, cada aviso não aberto continua marcado. O que foi visto fica só neste aparelho.
 */
export interface ActivitySeen {
  /** `createdAt` do aviso mais recente que já apareceu na tela. */
  newsAt: string | null;
  /** Quantos pedidos para seguir já apareceram na tela. */
  requests: number;
}

const SEEN_PREFIX = 'askout:activity-seen:';

export function readActivitySeen(storage: Pick<Storage, 'getItem'> | undefined, userId: string): ActivitySeen {
  try {
    const raw = storage?.getItem(SEEN_PREFIX + userId);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ActivitySeen>;
      return { newsAt: typeof parsed.newsAt === 'string' ? parsed.newsAt : null, requests: typeof parsed.requests === 'number' ? parsed.requests : 0 };
    }
  } catch {
    // sem armazenamento: a bolinha só some enquanto a aba estiver aberta
  }
  return { newsAt: null, requests: 0 };
}

export function writeActivitySeen(storage: Pick<Storage, 'setItem'> | undefined, userId: string, seen: ActivitySeen): void {
  try {
    storage?.setItem(SEEN_PREFIX + userId, JSON.stringify(seen));
  } catch {
    // ignora
  }
}

/** Tem algo novo para mostrar na bolinha? */
export function hasNewActivity(input: { latestUnreadAt: string | null; requests: number }, seen: ActivitySeen): boolean {
  const newNews = input.latestUnreadAt !== null && (seen.newsAt === null || input.latestUnreadAt > seen.newsAt);
  return newNews || input.requests > seen.requests;
}
