import { t } from '../lib/i18n/index.ts';
import type { ExploreEvent, ExplorePlace } from './types.ts';
/** Quantos rolês o passo guiado pede para a Home nascer com eventos. */
export const ONBOARDING_FOLLOW_GOAL = 3;

/**
 * Tour interativo do primeiro login: destaca o botão de verdade (marcado com data-tour no menu) e pede para a
 * pessoa tocar nele. Passo sem `to` só explica (ex.: Criar, que abriria uma janela) e segue com “Entendi”.
 */
export interface TourStep {
  target: string;
  title: string;
  text: string;
  /** Página que o toque abre; sem ela, o passo só explica. */
  to?: string;
}

export const TOUR_STEPS: readonly TourStep[] = [
  { target: 'home', to: '/', title: t('Sua Home'), text: t('Os eventos dos locais que você segue aparecem aqui. Toque em “Eu vou” para confirmar presença e receber um lembrete. Toque em Home.') },
  { target: 'explore', to: '/explorar', title: t('Explorar'), text: t('Ache bares, baladas e eventos perto de você, no mapa ou na lista. Toque em Explorar.') },
  { target: 'create', title: t('Criar'), text: t('Por aqui você cria um evento ou uma postagem e chama os amigos.') },
  { target: 'now', to: '/now', title: t('NOW: quem quer sair agora'), text: t('Ligue o NOW para avisar os amigos que você está livre. Quem também estiver livre pode te chamar. Toque em NOW.') },
  { target: 'agenda', to: '/agenda', title: t('Agenda'), text: t('Os eventos em que você vai ficam guardados aqui. Toque em Agenda.') },
  { target: 'chats', to: '/conversas', title: t('Conversas'), text: t('Amigo é quem se segue: quando os dois se seguem, vocês conversam direto. Toque em Conversas.') },
  { target: 'profile', to: '/perfil', title: t('Seu perfil'), text: t('Seus amigos, fotos e configurações ficam no perfil. Toque em Perfil para terminar.') },
];

/** Texto do contador do tour (“2 de 7”). */
export function tourProgressLabel(index: number, total = TOUR_STEPS.length): string {
  return t('{n} de {total}', { n: index + 1, total });
}

/** Onde pôr o balão do tour em relação ao botão destacado: ao lado (menu lateral), acima (barra de baixo) ou abaixo. */
export function tourPlacement(target: { left: number; right: number; top: number; bottom: number }, viewport: { width: number; height: number }): 'right' | 'above' | 'below' {
  if (target.right < viewport.width * 0.35 && viewport.width >= 720) return 'right';
  return (target.top + target.bottom) / 2 > viewport.height / 2 ? 'above' : 'below';
}

const key = (userId: string) => `askout.onboarded.${userId}`;

export function onboardingDone(storage: Pick<Storage, 'getItem'> | undefined, userId: string): boolean {
  try {
    return storage?.getItem(key(userId)) === '1';
  } catch {
    return false;
  }
}

export function markOnboardingDone(storage: Pick<Storage, 'setItem'> | undefined, userId: string): void {
  try {
    storage?.setItem(key(userId), '1');
  } catch {
    // sem armazenamento: o onboarding pode voltar numa próxima visita, sem prejuízo
  }
}

/**
 * Mostra o tutorial só no primeiro login: a conta guarda se a pessoa já passou por ele
 * (vale em qualquer aparelho), e o navegador guarda também, para fechar na hora.
 */
export function shouldShowOnboarding(storage: Pick<Storage, 'getItem'> | undefined, user: { id: string; onboarded?: boolean }): boolean {
  return user.onboarded !== true && !onboardingDone(storage, user.id);
}

/**
 * Locais dos próximos eventos, para o passo “siga 3 rolês” quando não há lista de locais por perto
 * (sem localização, ou nada perto): um por local, sem os eventos criados por pessoas sem rolê vinculado.
 */
export function placesFromEvents(events: readonly ExploreEvent[]): ExplorePlace[] {
  const seen = new Set<string>();
  const out: ExplorePlace[] = [];
  for (const { venue, sample, distanceM } of events) {
    if (!venue.id || seen.has(venue.id)) continue;
    seen.add(venue.id);
    out.push({
      key: `askout:${venue.id}`,
      source: 'ASKOUT',
      name: venue.name,
      category: venue.category,
      address: venue.address,
      lat: venue.lat,
      lng: venue.lng,
      sample,
      distanceM,
      rating: null,
      ratingCount: null,
      photoPath: null,
      photoAuthor: null,
      mapsUri: null,
      venue: { id: venue.id, logoUrl: venue.logoUrl, hours: null, followerCount: 0, following: false, claimed: false },
    });
  }
  return out;
}

/** Texto do progresso do passo “siga 3 rolês”. */
export function followProgressLabel(count: number): string {
  if (count >= ONBOARDING_FOLLOW_GOAL) return t('Pronto! Sua Home já terá eventos.');
  const missing = ONBOARDING_FOLLOW_GOAL - count;
  return missing === 1 ? t('Siga mais 1 local ({count} de {goal})', { count, goal: ONBOARDING_FOLLOW_GOAL }) : t('Siga mais {missing} locais ({count} de {goal})', { missing, count, goal: ONBOARDING_FOLLOW_GOAL });
}
