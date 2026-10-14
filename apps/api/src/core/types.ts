export type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'DELETION_REQUESTED';
export type UserRole = 'USER' | 'VENUE_OWNER' | 'ADMIN';
export type FollowStatus = 'PENDING' | 'ACCEPTED';
export type SlotState = 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE';

export interface User {
  id: string;
  email: string; // sempre minúsculo
  passwordHash: string;
  status: UserStatus;
  role: UserRole;
  createdAt: Date;
}

export interface Profile {
  userId: string;
  username: string; // sempre minúsculo
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  isPrivate: boolean;
}

export interface Follow {
  followerId: string;
  followeeId: string;
  status: FollowStatus;
  createdAt: Date;
}

/**
 * Cadastro aguardando o código enviado por e-mail. A conta (User + Profile) só é
 * criada depois da confirmação. Guarda o hash da senha, nunca a senha nem o código.
 */
export interface PendingSignup {
  email: string; // chave; sempre minúsculo
  username: string;
  displayName: string;
  passwordHash: string;
  codeHash: string;
  expiresAt: Date;
  /** Tentativas erradas de código. */
  attempts: number;
  /** Códigos enviados nesta janela de cadastro. */
  sendCount: number;
  lastSentAt: Date;
  createdAt: Date;
}

/** Dados de perfil que qualquer usuário autenticado pode ver em listas e buscas. */
export interface PublicProfile {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  isPrivate: boolean;
}

export interface Page {
  limit: number;
  offset: number;
}

export type Direction = 'followers' | 'following';

/** Quem está fazendo a requisição, já autenticado. */
export interface Actor {
  userId: string;
  role: UserRole;
}

export function toPublicProfile(p: Profile): PublicProfile {
  return {
    userId: p.userId,
    username: p.username,
    displayName: p.displayName,
    avatarUrl: p.avatarUrl,
    isPrivate: p.isPrivate,
  };
}

export const DEFAULT_PAGE_LIMIT = 30;
export const MAX_PAGE_LIMIT = 100;

export function normalizePage(input?: Partial<Page>): Page {
  const rawLimit = Number.isFinite(input?.limit) ? Math.trunc(input!.limit!) : DEFAULT_PAGE_LIMIT;
  const rawOffset = Number.isFinite(input?.offset) ? Math.trunc(input!.offset!) : 0;
  return {
    limit: Math.min(Math.max(rawLimit, 1), MAX_PAGE_LIMIT),
    offset: Math.max(rawOffset, 0),
  };
}

/** Horário informado manualmente por uma pessoa. Intervalo semiaberto [startsAt, endsAt). */
export interface AvailabilitySlotRecord {
  id: string;
  userId: string;
  startsAt: Date;
  endsAt: Date;
  state: SlotState;
  createdAt: Date;
}

/** Flash ligado por uma pessoa: ela está disponível "agora" até `expiresAt`. */
export interface FlashSessionRecord {
  id: string;
  userId: string;
  startsAt: Date;
  expiresAt: Date;
  /** Preenchido quando a pessoa desliga antes do fim. */
  endedAt: Date | null;
  note: string | null;
}

export type FlashInviteStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'CANCELED' | 'EXPIRED' | 'ENDED';

/** Convite entre dois amigos com Flash ligado. ACCEPTED é o "encontro": só nele a posição é compartilhada. */
export interface FlashInviteRecord {
  id: string;
  fromUserId: string;
  toUserId: string;
  status: FlashInviteStatus;
  createdAt: Date;
  expiresAt: Date;
  respondedAt: Date | null;
  endedAt: Date | null;
}

/** Última posição de uma pessoa num encontro. Sem histórico: cada atualização substitui a anterior. */
export interface FlashPositionRecord {
  inviteId: string;
  userId: string;
  lat: number;
  lng: number;
  accuracyM: number | null;
  updatedAt: Date;
}

// ---------- Conversas ----------

export type MessageKind = 'TEXT' | 'SUGGESTION' | 'MEETUP' | 'SYSTEM' | 'EVENT';
export type SuggestionResponse = 'ACCEPTED' | 'DECLINED';

/**
 * Conversa 1 a 1 entre amigos (`directKey` = "<menor id>:<maior id>", único por dupla) ou grupo de um encontro
 * (`name` e `ownerId`; entra quem aceita o convite do encontro).
 */
export interface ConversationRecord {
  id: string;
  type: 'DIRECT' | 'GROUP';
  directKey: string | null;
  name: string | null;
  ownerId: string | null;
  /** Foto do grupo como data URL (jpeg/png/webp, até 40 KB). Ainda não há armazenamento de arquivos. */
  imageUrl: string | null;
  createdAt: Date;
}

/** Cartão de sugestão enviado numa conversa. Não carrega nada sobre onde as pessoas estão. */
export interface SuggestionCard {
  source: 'EVENT' | 'OSM' | 'GOOGLE';
  title: string;
  venueName: string;
  lat: number;
  lng: number;
  startsAt: string | null;
  endsAt: string | null;
  /** Dado de teste (nunca apresentado como real). */
  sample: boolean;
  /** Id do evento no AskouT ou do elemento no OpenStreetMap, para evitar duplicatas. */
  externalId: string;
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  senderId: string;
  kind: MessageKind;
  body: string;
  suggestion: SuggestionCard | null;
  /** Resposta de quem recebeu o cartão; nula enquanto não respondeu e sempre nula em texto. */
  response: SuggestionResponse | null;
  respondedAt: Date | null;
  /** Cartão de encontro (kind MEETUP). */
  meetupId: string | null;
  /** Evento compartilhado (kind EVENT). Ausente = nulo. */
  eventId?: string | null;
  createdAt: Date;
}

export interface ConversationSummaryRecord {
  conversation: ConversationRecord;
  participantIds: string[];
  lastMessage: MessageRecord | null;
  unread: number;
}

// ---------- Lugares e eventos ----------

export interface VenueRecord {
  id: string;
  name: string;
  address: string | null;
  category: string | null;
  lat: number;
  lng: number;
  isSample: boolean;
}

export type EventKind = 'DIGITAL' | 'SHOW' | 'CINEMA' | 'THEATER' | 'EXHIBITION' | 'GASTRONOMY' | 'NIGHT' | 'OTHER';
export const EVENT_KINDS: readonly EventKind[] = ['DIGITAL', 'SHOW', 'CINEMA', 'THEATER', 'EXHIBITION', 'GASTRONOMY', 'NIGHT', 'OTHER'];

export interface PlaceEventRecord {
  id: string;
  venueId: string;
  title: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date;
  kind: EventKind;
  isFree: boolean;
  /** Imagem https de quem criou o evento. */
  imageUrl: string | null;
  /** Hashtags em minúsculas, sem "#" e sem acento. */
  tags: string[];
  isSample: boolean;
}

/** Lugar vindo de uma fonte externa (Google Places ou OpenStreetMap). Dados do Google só vivem na memória, nunca no banco. */
export interface ExternalPlace {
  externalId: string;
  source: 'GOOGLE' | 'OSM';
  name: string;
  category: string | null;
  lat: number;
  lng: number;
  /** Nota de 0 a 5 e número de avaliações (só Google). */
  rating?: number | null;
  ratingCount?: number | null;
  /** Referência opaca da foto na fonte; a imagem é buscada pelo servidor, a chave nunca vai ao app. */
  photoRef?: string | null;
  /** Quem tirou a foto, para o crédito exigido pelo Google. */
  photoAuthor?: string | null;
  /** Endereço da página do lugar na fonte. */
  mapsUri?: string | null;
}

// ---------- Encontros ----------

export type MeetupParticipantStatus = 'INVITED' | 'CONFIRMED' | 'DECLINED';

export interface MeetupParticipantRecord {
  userId: string;
  status: MeetupParticipantStatus;
  respondedAt: Date | null;
}

/** Encontro marcado a partir de um evento. Quem organiza já entra confirmado; os convidados aceitam ou recusam. */
export interface MeetupRecord {
  id: string;
  organizerId: string;
  /** Conversa onde o encontro vive: a 1 a 1 (um convidado) ou a do grupo (vários). */
  conversationId: string;
  eventId: string | null;
  title: string;
  startsAt: Date;
  endsAt: Date;
  status: 'ACTIVE' | 'CANCELLED';
  createdAt: Date;
  participants: MeetupParticipantRecord[];
}

// ---------- Avisos ----------

export type NotificationType = 'MESSAGE' | 'MEETUP_INVITE' | 'MEETUP_ACCEPTED' | 'MEETUP_CANCELLED' | 'GROUP_REMOVED' | 'FOLLOW_REQUEST' | 'FOLLOW_ACCEPTED' | 'FLASH_INVITE' | 'POST_TAG';

/** Aviso guardado para a pessoa. `url` é um caminho dentro do app; `dedupeKey` evita avisos repetidos enquanto o anterior não foi lido. */
export interface NotificationRecord {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  url: string;
  dedupeKey: string | null;
  readAt: Date | null;
  createdAt: Date;
}

/** Inscrição de um aparelho/navegador para receber Web Push. */
export interface PushSubscriptionRecord {
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  createdAt: Date;
}

/** Foto de perfil guardada no banco (já reduzida pelo app). */
export interface ProfilePhotoRecord {
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  data: Uint8Array;
  updatedAt: Date;
}

/** Post de uma pessoa: 1 a 5 fotos (enviadas por ela ou a foto de um lugar) e legenda opcional. */
export interface PostRecord {
  id: string;
  authorId: string;
  caption: string | null;
  placeName: string | null;
  placeAddress: string | null;
  /** Post que é um evento criado pela pessoa: título e horário (o lugar é `placeName`). */
  eventTitle: string | null;
  eventStartsAt: Date | null;
  eventEndsAt: Date | null;
  createdAt: Date;
}

export interface PostImageRecord {
  id: string;
  postId: string;
  position: number;
  /** Foto enviada: tipo e bytes. Foto do lugar: ambos nulos e `placePhotoRef` preenchido. */
  mime: string | null;
  data: Uint8Array | null;
  placePhotoRef: string | null;
  placePhotoAuthor: string | null;
}

/** Imagem sem os bytes (a lista não carrega as fotos, só o endereço delas). */
export interface PostImageMeta {
  id: string;
  position: number;
  isUpload: boolean;
  placePhotoRef: string | null;
  placePhotoAuthor: string | null;
}

export interface PostWithImages {
  post: PostRecord;
  images: PostImageMeta[];
}

export type PostTagStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED';

export interface PostTagRecord {
  postId: string;
  userId: string;
  status: PostTagStatus;
  createdAt: Date;
}
