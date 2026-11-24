import type { NotificationType } from './types.ts';

/**
 * Sons dos avisos (push) que a pessoa escolhe por grupo, em Configuração > Notificações.
 *
 * - `padrao`: o som de aviso do próprio aparelho (como sempre foi).
 * - `silencioso`: o aviso aparece, mas sem som (e sem vibrar).
 * - os demais são sons do AskouT, que vão dentro do app: `askout.wav`, `pop.wav`... no iPhone (pacote do app) e em
 *   `res/raw` no Android. O mesmo arquivo fica em apps/web/public/sons para a prévia na tela.
 *
 * Como cada sistema toca:
 * - iPhone: o servidor manda o nome do arquivo em `aps.sound`. Arquivo que não existe (app antigo) vira o som padrão.
 * - Android 8+: o som é do canal da notificação, e o canal não muda depois de criado. Por isso há um canal por som
 *   (`notificacoes` é o padrão, `som_<id>` os outros), que o app cria ao abrir; o servidor escolhe o canal.
 *   Se a pessoa mudar o som de um canal nos ajustes do Android, vale o que ela escolheu lá.
 * - Navegador: não deixa escolher o som; só o `silencioso` vale (o aviso chega sem som).
 */
export const NOTIFICATION_SOUNDS = ['padrao', 'askout', 'pop', 'sino', 'brilho', 'silencioso'] as const;
export type NotificationSound = (typeof NOTIFICATION_SOUNDS)[number];

/** Sons que são arquivos do app (os outros dois são do sistema). */
export const CUSTOM_SOUNDS: readonly NotificationSound[] = ['askout', 'pop', 'sino', 'brilho'];

/** Grupos de aviso com som próprio. `arrival` é a chegada do amigo no NOW (o aviso que se atualiza). */
export const SOUND_GROUPS = ['chats', 'invites', 'arrival', 'other'] as const;
export type SoundGroup = (typeof SOUND_GROUPS)[number];

export type NotificationSoundSettings = Record<SoundGroup, NotificationSound>;

export const DEFAULT_SOUNDS: NotificationSoundSettings = { chats: 'padrao', invites: 'padrao', arrival: 'padrao', other: 'padrao' };

export function isNotificationSound(value: unknown): value is NotificationSound {
  return typeof value === 'string' && (NOTIFICATION_SOUNDS as readonly string[]).includes(value);
}

/** Valor guardado no banco (texto livre) para o som; o que não for conhecido volta ao padrão. */
export function soundOrDefault(value: unknown): NotificationSound {
  return isNotificationSound(value) ? value : 'padrao';
}

/** De que grupo de som é cada tipo de aviso. A chegada do amigo não passa por aqui (vai direto em `arrival`). */
export function soundGroup(type: NotificationType): Exclude<SoundGroup, 'arrival'> {
  if (type === 'MESSAGE' || type === 'GROUP_REMOVED') return 'chats';
  if (type === 'MEETUP_INVITE' || type === 'MEETUP_ACCEPTED' || type === 'MEETUP_CANCELLED' || type === 'FLASH_INVITE' || type === 'GUEST_LIST') return 'invites';
  return 'other';
}

/** Canal do Android para cada som. Mesmos ids que o app cria (NotificationSounds.java). */
export function androidChannelFor(sound: NotificationSound): string {
  return sound === 'padrao' ? 'notificacoes' : `som_${sound}`;
}

/** Valor de `aps.sound` no iPhone; `undefined` é sem som. */
export function apnsSoundFor(sound: NotificationSound): string | undefined {
  if (sound === 'silencioso') return undefined;
  return sound === 'padrao' ? 'default' : `${sound}.wav`;
}
