import { t } from '../lib/i18n/index.ts';
/** Quantos rolês o passo guiado pede para a Home nascer com eventos. */
export const ONBOARDING_FOLLOW_GOAL = 3;

export const ONBOARDING_SLIDES: readonly { title: string; text: string }[] = [
  { title: t('Siga bares e baladas, veja eventos'), text: t('Os eventos dos rolês que você segue aparecem na sua Home. Toque em “Eu vou” para confirmar presença e receber um lembrete antes de começar.') },
  { title: t('Amigo é quem se segue'), text: t('Quando você segue alguém e essa pessoa segue você de volta, vocês viram amigos. Só amigos veem seus planos e conversam direto com você.') },
  { title: t('Flash: encontre quem quer sair agora'), text: t('Ligue o Flash para avisar os amigos que você está livre. Quem também estiver livre pode te chamar, e a conversa abre na hora.') },
];

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

/** Texto do progresso do passo “siga 3 rolês”. */
export function followProgressLabel(count: number): string {
  if (count >= ONBOARDING_FOLLOW_GOAL) return t('Pronto! Sua Home já terá eventos.');
  const missing = ONBOARDING_FOLLOW_GOAL - count;
  return missing === 1 ? t('Siga mais 1 rolê ({count} de {goal})', { count, goal: ONBOARDING_FOLLOW_GOAL }) : t('Siga mais {missing} rolês ({count} de {goal})', { missing, count, goal: ONBOARDING_FOLLOW_GOAL });
}
