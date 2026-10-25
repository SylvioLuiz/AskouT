import { t } from '../lib/i18n/index.ts';
import type { Relationship } from './types.ts';

export type ProfileAction =
  | { kind: 'self' }
  | { kind: 'blocked' }
  | { kind: 'follow'; label: string }
  | { kind: 'requested'; label: string }
  | { kind: 'following'; label: string };

/** Qual botão principal o perfil mostra para quem está olhando. */
export function profileAction(relationship: Relationship): ProfileAction {
  if (relationship.isSelf) return { kind: 'self' };
  if (relationship.blockedByViewer) return { kind: 'blocked' };
  if (relationship.following === 'ACCEPTED') return { kind: 'following', label: t('Seguindo') };
  if (relationship.following === 'PENDING') return { kind: 'requested', label: t('Solicitado') };
  return { kind: 'follow', label: relationship.followsYou === 'ACCEPTED' ? t('Seguir de volta') : 'Seguir' };
}

/** Frase curta sobre a relação, quando há algo a dizer. */
export function relationNote(relationship: Relationship): string | undefined {
  if (relationship.isSelf || relationship.blockedByViewer) return undefined;
  if (relationship.isFriend) return t('Vocês são amigos');
  if (relationship.followsYou === 'ACCEPTED') return t('Segue você');
  return undefined;
}

/** Esta pessoa pediu para seguir o visitante e aguarda resposta. */
export function hasIncomingRequest(relationship: Relationship): boolean {
  return !relationship.isSelf && !relationship.blockedByViewer && relationship.followsYou === 'PENDING';
}
