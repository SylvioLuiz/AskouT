/** Quantos bares o passo guiado pede para a Home nascer com eventos. */
export const ONBOARDING_FOLLOW_GOAL = 3;

export const ONBOARDING_SLIDES: readonly { title: string; text: string }[] = [
  { title: 'Siga bares, veja eventos', text: 'Os eventos dos bares que você segue aparecem na sua Home. Toque em “Eu vou” para confirmar presença e receber um lembrete antes de começar.' },
  { title: 'Amigo é quem se segue', text: 'Quando você segue alguém e essa pessoa segue você de volta, vocês viram amigos. Só amigos veem seus planos e conversam direto com você.' },
  { title: 'Flash: encontre quem quer sair agora', text: 'Ligue o Flash para avisar os amigos que você está livre. Quem também estiver livre pode te chamar, e a conversa abre na hora.' },
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

/** Texto do progresso do passo “siga 3 bares”. */
export function followProgressLabel(count: number): string {
  if (count >= ONBOARDING_FOLLOW_GOAL) return 'Pronto! Sua Home já terá eventos.';
  const missing = ONBOARDING_FOLLOW_GOAL - count;
  return `Siga mais ${missing} ${missing === 1 ? 'bar' : 'bares'} (${count} de ${ONBOARDING_FOLLOW_GOAL})`;
}
