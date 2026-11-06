// Registro de atividades (tela "Suas interações"): tipos da API e regras de texto, link e agrupamento por dia.
import { intlLocale, t } from './i18n/index.ts';
import type { PublicProfile } from './types.ts';

export type ActivityKind = 'LIKE' | 'COMMENT' | 'POST' | 'FOLLOW' | 'EVENT';
export type ActivityFilter = 'ALL' | ActivityKind;
export type ActivityAction = 'POST_LIKE' | 'FEED_REACTION' | 'POST_COMMENT' | 'FEED_COMMENT' | 'POST_CREATED' | 'EVENT_CREATED' | 'FEED_POST' | 'EVENT_GOING' | 'FOLLOW_USER' | 'FOLLOW_VENUE';

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  action: ActivityAction;
  at: string;
  /** false: a conta foi bloqueada, suspensa ou o post foi arquivado. O item fica, sem link. */
  available: boolean;
  target: { type: 'POST' | 'USER_EVENT' | 'PLACE_EVENT' | 'VENUE' | 'USER'; id: string } | null;
  person: PublicProfile | null;
  title: string | null;
  text: string | null;
  pending: boolean;
}

export interface ActivityPage {
  items: ActivityItem[];
  nextCursor: string | null;
}

/** Chips do topo, na ordem em que aparecem. */
export const ACTIVITY_FILTERS: { id: ActivityFilter; label: () => string }[] = [
  { id: 'ALL', label: () => t('Todas') },
  { id: 'LIKE', label: () => t('Curtidas') },
  { id: 'COMMENT', label: () => t('Comentários') },
  { id: 'POST', label: () => t('Posts') },
  { id: 'FOLLOW', label: () => t('Seguindo') },
  { id: 'EVENT', label: () => t('Eventos') },
];

/** Para onde o item leva no app; undefined se não leva a lugar nenhum. */
export function activityPath(item: ActivityItem): string | undefined {
  if (!item.available || !item.target) return undefined;
  const id = encodeURIComponent(item.target.id);
  switch (item.target.type) {
    case 'POST':
      return `/posts/${id}`;
    case 'USER_EVENT':
    case 'PLACE_EVENT':
      return `/eventos/${id}`;
    case 'VENUE':
      return `/bares/${id}`;
    case 'USER':
      return item.person ? `/u/${encodeURIComponent(item.person.username)}` : undefined;
  }
}

/** Frase principal do item, em linguagem simples. */
export function activitySentence(item: ActivityItem): string {
  const who = item.person ? `@${item.person.username}` : '';
  const title = item.title ?? '';
  if (!item.available) {
    switch (item.action) {
      case 'POST_COMMENT':
      case 'FEED_COMMENT':
        return t('Você comentou num conteúdo que não está mais disponível');
      case 'FOLLOW_USER':
        return t('Você seguiu uma conta que não está mais disponível');
      case 'FEED_POST':
        return t('Você publicou num evento que não está mais disponível');
      case 'EVENT_GOING':
        return t('Você confirmou presença num evento que não está mais disponível');
      default:
        return t('Você curtiu um conteúdo que não está mais disponível');
    }
  }
  switch (item.action) {
    case 'POST_LIKE':
      if (item.target?.type === 'USER_EVENT') return who ? t('Você curtiu o evento {title} de {who}', { title, who }) : t('Você curtiu o seu evento {title}', { title });
      return who ? t('Você curtiu um post de {who}', { who }) : t('Você curtiu o seu post');
    case 'FEED_REACTION':
      return who ? t('Você reagiu a uma publicação de {who} em {title}', { who, title }) : t('Você reagiu a uma publicação em {title}', { title });
    case 'POST_COMMENT':
      return who ? t('Você comentou num post de {who}', { who }) : t('Você comentou no seu post');
    case 'FEED_COMMENT':
      return who ? t('Você comentou numa publicação de {who} em {title}', { who, title }) : t('Você comentou numa publicação em {title}', { title });
    case 'POST_CREATED':
      return t('Você publicou um post');
    case 'EVENT_CREATED':
      return t('Você criou o evento {title}', { title });
    case 'FEED_POST':
      return item.pending ? t('Você publicou em {title} (esperando aprovação)', { title }) : t('Você publicou em {title}', { title });
    case 'EVENT_GOING':
      return t('Você confirmou presença em {title}', { title });
    case 'FOLLOW_USER':
      return item.pending ? t('Você pediu para seguir {who}', { who }) : t('Você passou a seguir {who}', { who });
    case 'FOLLOW_VENUE':
      return t('Você passou a seguir {title}', { title });
  }
}

/** Texto menor embaixo: o que a pessoa escreveu ou o emoji; em post curtido, o começo da legenda. */
export function activityDetail(item: ActivityItem): string | null {
  if (item.action === 'POST_LIKE' && item.target?.type === 'POST') return item.title;
  return item.text;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** "Hoje", "Ontem" ou a data por extenso (com o ano só se for de outro ano). */
export function activityDayLabel(iso: string, now: Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (dayKey(d) === dayKey(now)) return t('Hoje');
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (dayKey(d) === dayKey(yesterday)) return t('Ontem');
  return d.toLocaleDateString(intlLocale(), { day: 'numeric', month: 'long', ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }) });
}

/** Agrupa por dia (a lista já vem do mais recente ao mais antigo). */
export function groupByDay(items: readonly ActivityItem[], now: Date): { key: string; label: string; items: ActivityItem[] }[] {
  const groups: { key: string; label: string; items: ActivityItem[] }[] = [];
  for (const item of items) {
    const key = dayKey(new Date(item.at));
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, label: activityDayLabel(item.at, now), items: [item] });
  }
  return groups;
}

/** Junta a página nova sem repetir itens (caso a mesma página chegue duas vezes). */
export function appendPage(current: readonly ActivityItem[], next: readonly ActivityItem[]): ActivityItem[] {
  const seen = new Set(current.map((i) => i.id));
  return [...current, ...next.filter((i) => !seen.has(i.id))];
}
