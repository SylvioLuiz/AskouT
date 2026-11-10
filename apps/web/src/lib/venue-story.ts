import { formatDistance } from './flash.ts';
import { t } from './i18n/index.ts';
import type { RollingNowItem } from './types.ts';

/** "Ana vai", "Ana e mais 1 amigo vão", "Ana e mais 3 amigos vão"; null sem amigos confirmados. */
export function friendsLine(item: Pick<RollingNowItem, 'friendsGoing' | 'friendsGoingCount'>): string | null {
  const first = item.friendsGoing[0];
  if (!first || item.friendsGoingCount <= 0) return null;
  const others = item.friendsGoingCount - 1;
  if (others <= 0) return t('{name} vai', { name: first.username });
  return others === 1 ? t('{name} e mais 1 amigo vão', { name: first.username }) : t('{name} e mais {n} amigos vão', { name: first.username, n: others });
}

/** Linhas curtas de contexto de um item da faixa "Rolando agora": distância, amigos e interesse. */
export function rollingMeta(item: RollingNowItem): string[] {
  const out: string[] = [];
  if (item.distanceM !== null) out.push(formatDistance(item.distanceM));
  const friends = friendsLine(item);
  if (friends) out.push(friends);
  else if (item.interest) out.push(t('Tem a ver com você'));
  return out;
}
