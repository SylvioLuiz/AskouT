import { t } from '../lib/i18n/index.ts';
const FOLLOW_KEY = 'askout.hint.follow';

export const FOLLOW_HINT = t('Quando vocês se seguirem, viram amigos. Aí dá para conversar, marcar encontros e ver os planos um do outro.');

/** Devolve true só na primeira vez (e grava que a dica já foi dada). Sem armazenamento, a dica aparece sempre. */
export function takeFirstFollowHint(storage: Pick<Storage, 'getItem' | 'setItem'> | undefined): boolean {
  try {
    if (storage?.getItem(FOLLOW_KEY) === '1') return false;
    storage?.setItem(FOLLOW_KEY, '1');
  } catch {
    return true;
  }
  return true;
}

export function safeStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

const FLASH_KEY = 'askout.hint.flash';

/** O que a pessoa precisa saber antes de ligar o Flash pela primeira vez. */
export const FLASH_PRIVACY_POINTS: readonly string[] = [
  t('Só amigos (quem se segue de volta) que também estão com o Flash ligado veem que você está livre.'),
  t('Você escolhe por quanto tempo. Passou o tempo, o Flash desliga sozinho, e você pode desligar quando quiser.'),
  t('Se você escrever um recado, os mesmos amigos veem.'),
  t('Sua localização só é compartilhada depois que você aceita um convite e abre o encontro, e só com a pessoa do encontro. Quando o Flash ou o encontro termina, ela deixa de ser enviada.'),
];

export function flashNoticeSeen(storage: Pick<Storage, 'getItem'> | undefined): boolean {
  try {
    return storage?.getItem(FLASH_KEY) === '1';
  } catch {
    return false;
  }
}

export function markFlashNoticeSeen(storage: Pick<Storage, 'setItem'> | undefined): void {
  try {
    storage?.setItem(FLASH_KEY, '1');
  } catch {
    // sem armazenamento: o aviso pode voltar numa próxima vez
  }
}
