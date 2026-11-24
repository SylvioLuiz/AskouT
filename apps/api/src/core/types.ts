import type { StoryOverlay } from './story-overlays.ts';
import type { EventExtraAnswer } from './event-extras.ts';
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
  /** Data de nascimento (AAAA-MM-DD), informada uma vez para liberar o Flash. Nunca aparece no perfil público. */
  birthDate?: string | null;
  /** Quando e em qual versão dos Termos a pessoa deu o aceite. */
  termsAcceptedAt?: Date | null;
  termsVersion?: string | null;
  /** Quando a pessoa terminou (ou pulou) o tutorial inicial. Vazio = ainda não viu. */
  onboardedAt?: Date | null;
  /** Gostos de rolê (ids do catálogo de gostos, ver tastes.ts). Vazio = gosta de tudo. */
  tastes?: string[];
  /** Conta criada pelo Google/Apple que ainda não escolheu o nome de usuário nem informou a data de nascimento. Até concluir, o app só mostra essa etapa. */
  profilePending?: boolean;
  /** Conta criada pelo Google/Apple que nunca definiu senha: só entra pela plataforma (ou criando uma senha pelo "Esqueci a senha"). */
  passwordless?: boolean;
  /** Celular (E.164). Privado: nunca vai para o perfil público. */
  phone?: string | null;
  /** Quando o celular atual foi confirmado por SMS. Só celular confirmado serve para entrar sem senha. Trocar o número apaga. */
  phoneVerifiedAt?: Date | null;
}

/** Para que serve o código mandado por SMS: entrar na conta ou confirmar o celular cadastrado. */
export type PhoneCodePurpose = 'LOGIN' | 'VERIFY';

/** Código por SMS em andamento: um por pessoa. Guarda só o HMAC do código e o número para onde foi. */
export interface PhoneCode {
  userId: string;
  purpose: PhoneCodePurpose;
  phone: string;
  codeHash: string;
  expiresAt: Date;
  attempts: number;
  sendCount: number;
  lastSentAt: Date;
}

/** Pedido de nova senha em andamento: um por pessoa. `channel` deixa pronto o envio por celular (SMS) no futuro. */
export interface PasswordReset {
  userId: string;
  channel: 'EMAIL';
  codeHash: string;
  expiresAt: Date;
  attempts: number;
  sendCount: number;
  lastSentAt: Date;
}

/** Verificação em duas etapas por app autenticador (TOTP). Sem `enabledAt`, a configuração começou mas ainda não foi confirmada. */
export interface UserMfa {
  userId: string;
  /** Segredo TOTP cifrado (AES-256-GCM); nunca fica em texto puro no banco. */
  secretSealed: string;
  enabledAt: Date | null;
  /** HMAC dos códigos de recuperação que ainda não foram usados. */
  recoveryCodeHashes: string[];
  /** Último passo de 30 s aceito: o mesmo código não vale duas vezes. */
  lastUsedStep: number;
  failedAttempts: number;
  lockedUntil: Date | null;
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
/** Plataformas de login externo. Cada conta externa liga a uma conta do AskouT pelo ID dela, nunca pelo nome. */
export type ExternalProvider = 'GOOGLE' | 'APPLE';

/** O que a plataforma garante sobre quem entrou (já com a assinatura do token conferida). */
export interface IdentityClaims {
  /** ID fixo da pessoa naquela plataforma. */
  subject: string;
  email: string | null;
  /** Só um e-mail verificado pela plataforma pode ligar a uma conta que já existe. */
  emailVerified: boolean;
  name: string | null;
  /** Foto do perfil na plataforma (o Google manda; a Apple não). */
  picture?: string | null;
}

/** Usos opcionais dos dados que a pessoa liga e desliga (LGPD, art. 8º): nada disso é preciso para usar o app. */
export type ConsentPurpose = 'MARKETING_EMAIL' | 'MARKETING_PUSH';
/** Onde a pessoa deu ou tirou o consentimento. */
export type ConsentSource = 'SIGNUP' | 'SETTINGS';

/** Registro imutável de cada vez que a pessoa deu ou tirou um consentimento. O estado atual é o registro mais recente. */
export interface ConsentEventRecord {
  id: string;
  userId: string;
  purpose: ConsentPurpose;
  granted: boolean;
  source: ConsentSource;
  at: Date;
}

export interface PendingSignup {
  email: string; // chave; sempre minúsculo
  username: string;
  displayName: string;
  passwordHash: string;
  /** Data de nascimento (AAAA-MM-DD) e versão dos Termos aceita, guardadas até o código ser confirmado. */
  birthDate: string;
  termsVersion: string;
  /** Aceitou receber novidades por e-mail no cadastro (opcional, desmarcado por padrão). */
  marketingEmail?: boolean;
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
  /** Ordenação pedida pela gestão (coluna da tabela). Sem ela, cada lista usa a ordem de sempre. */
  sort?: PageSort;
}

export interface PageSort {
  key: string;
  dir: 'asc' | 'desc';
}

/** Colunas pelas quais cada tabela paginada da gestão pode ser ordenada (a API recusa outras). */
export const ADMIN_SORTS = {
  users: ['username', 'email', 'status', 'posts', 'birthDate', 'createdAt'],
  venues: ['name', 'category', 'owner', 'events'],
  events: ['title', 'venue', 'startsAt', 'kind'],
  posts: ['caption', 'author', 'createdAt', 'reports'],
  audit: ['createdAt', 'action', 'targetType'],
} as const;

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
  /** Região aproximada (~1 km) de quando ligou, só para ordenar por distância. Nunca vai para outra pessoa. */
  area?: { lat: number; lng: number } | null;
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
  /** Lugar que um dos dois escolheu para se encontrarem. Some junto com o encontro. */
  destination?: FlashDestination | null;
  /** Quem convidou escolheu mostrar só a posição aproximada (~1 km). */
  fromApprox?: boolean;
  /** Quem foi convidado escolheu mostrar só a posição aproximada (~1 km). */
  toApprox?: boolean;
  /** Quem convidou liberou o outro a acompanhar a chegada dele nas notificações do celular. */
  fromArrival?: boolean;
  /** Quem foi convidado liberou o outro a acompanhar a chegada dele nas notificações do celular. */
  toArrival?: boolean;
}

/** Lugar escolhido no mapa do encontro Flash. */
export interface FlashDestination {
  name: string;
  lat: number;
  lng: number;
  chosenById: string;
  chosenAt: Date;
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

export type MessageKind = 'TEXT' | 'SUGGESTION' | 'MEETUP' | 'SYSTEM' | 'EVENT' | 'AUDIO' | 'IMAGE' | 'VIDEO' | 'FILE';
export type SuggestionResponse = 'ACCEPTED' | 'DECLINED' | 'CANCELED';

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
  /** Grupo criado para um evento de pessoa (post): pela página do evento ou pela votação da data. */
  eventPostId?: string | null;
  /** Só DIRECT: solicitação de mensagem pendente para esta pessoa (nula = conversa normal). */
  requestToId?: string | null;
  /** Quem recebeu a solicitação recusou: some para ela até chegar mensagem nova. */
  requestDeclinedAt?: Date | null;
  /** A solicitação foi aceita: a conversa fica liberada nos dois sentidos, mesmo sem seguir. */
  acceptedAt?: Date | null;
  /** Conversa com a página de um local: quem escreveu fala com o local, e o dono responde por ele. */
  venueId?: string | null;
  createdAt: Date;
}

/** Cartão de sugestão enviado numa conversa. Não carrega nada sobre onde as pessoas estão. */
export interface SuggestionCard {
  /** PLACE: local cadastrado no AskouT (vem da busca "Sugerir outro lugar"). */
  source: 'EVENT' | 'OSM' | 'GOOGLE' | 'PLACE';
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
  /** Evento criado por uma pessoa (um post) compartilhado (kind EVENT, no lugar de eventId). */
  postEventId?: string | null;
  /** Duração da mensagem de voz em ms (kind AUDIO). O áudio em si fica à parte. */
  audioMs?: number | null;
  /** GIF (Giphy) anexado: mensagem kind TEXT com `body` "GIF". */
  gifId?: string | null;
  gifUrl?: string | null;
  /** Story respondido (ou reagido): a mensagem mostra o story anexado. */
  storyId?: string | null;
  /** Mensagem que esta responde (na mesma conversa). */
  replyToId?: string | null;
  /** Apagada por quem enviou: some para todos, vira "Mensagem apagada". */
  deletedAt?: Date | null;
  createdAt: Date;
}

/** Uma reação por pessoa e mensagem. */
export interface MessageReactionRecord {
  messageId: string;
  userId: string;
  emoji: string;
}

export interface ConversationPrefsRecord {
  /** Quando a pessoa fixou a conversa; nulo = não fixada. */
  pinnedAt: Date | null;
  muted: boolean;
  /** Cor escolhida para a conversa (uma de CHAT_COLORS); nula = cor padrão do app. */
  color: string | null;
}

export interface ConversationSummaryRecord {
  conversation: ConversationRecord;
  participantIds: string[];
  lastMessage: MessageRecord | null;
  unread: number;
  /** Preferências de quem pediu a lista. */
  pinnedAt?: Date | null;
  muted?: boolean;
  /** Quando quem pediu a lista limpou/apagou a conversa (mensagens até aí não aparecem para ela). */
  clearedAt?: Date | null;
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
  /** Quem administra o local (reivindicação aprovada). */
  ownerId?: string | null;
  /** Perfil do estabelecimento. Tudo opcional: um local sem dono só tem nome, endereço e posição. */
  description?: string | null;
  /** Horário de funcionamento de domingo (0) a sábado (6); `null` num dia = fechado. */
  hours?: VenueHours | null;
  /** Capa: endereço https ou `/venues/:id/cover?v=` quando enviada do aparelho. */
  coverUrl?: string | null;
  /** Logo (círculo da página): https ou `/venues/:id/logo?v=` quando enviada do aparelho. */
  logoUrl?: string | null;
  /** @ do Instagram, sem "@" e em minúsculas. */
  instagram?: string | null;
  /** Origem externa ("google:ID", "osm:ID") de um local que entrou sob demanda. */
  externalKey?: string | null;
  /** Foto do Google (referência opaca) e o crédito de quem tirou. Só para locais externos. */
  photoRef?: string | null;
  photoAuthor?: string | null;
  /** Organização (bateria, atlética...) em vez de estabelecimento. Sem dono, fica fora das buscas. */
  isOrganization?: boolean;
  /** Criado do zero por alguém no app (pedido com documento). Sem dono, fica fora das buscas. */
  isUserCreated?: boolean;
}

/** Abre e fecha em "HH:MM"; `close` menor ou igual a `open` significa que passa da meia-noite. */
export interface VenueDayHours {
  open: string;
  close: string;
}
export type VenueHours = (VenueDayHours | null)[];

/** Campos que o dono edita no perfil. */
export interface VenueProfilePatch {
  name: string;
  address: string | null;
  category: string | null;
  description: string | null;
  hours: VenueHours | null;
  coverUrl: string | null;
  logoUrl: string | null;
  /** Ausente mantém o que está gravado. */
  instagram?: string | null;
}

export type ClaimStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export const CLAIM_DOCUMENT_MIMES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const;
export type ClaimDocumentMime = (typeof CLAIM_DOCUMENT_MIMES)[number];

/** Pedido de uma pessoa para administrar um local. O documento (CNPJ, alvará) só o admin vê. */
/** Convite/vínculo de administrador adicional de um local. Só vale com `ACCEPTED`. */
export interface VenueManagerRecord {
  venueId: string;
  userId: string;
  status: 'PENDING' | 'ACCEPTED';
  invitedById: string;
  createdAt: Date;
  acceptedAt: Date | null;
}

export interface VenueClaimRecord {
  id: string;
  venueId: string;
  userId: string;
  status: ClaimStatus;
  note: string | null;
  documentMime: ClaimDocumentMime;
  /** Motivo da recusa, escrito pelo admin. */
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
}

export type EventKind = 'DIGITAL' | 'SHOW' | 'CINEMA' | 'THEATER' | 'EXHIBITION' | 'GASTRONOMY' | 'NIGHT' | 'OUTDOOR' | 'SPORT' | 'OTHER';
export const EVENT_KINDS: readonly EventKind[] = ['DIGITAL', 'SHOW', 'CINEMA', 'THEATER', 'EXHIBITION', 'GASTRONOMY', 'NIGHT', 'OUTDOOR', 'SPORT', 'OTHER'];

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
  /** Link https para comprar ingresso (site do próprio local ou de uma bilheteria). Ausente/nulo: sem link. */
  ticketUrl?: string | null;
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
  /** Endereço do lugar (só na busca por texto e no detalhe do Google). */
  address?: string | null;
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
  /** Evento criado por uma pessoa (post) de onde o encontro saiu. Liga pelo ID: o nome do evento pode mudar. */
  eventPostId: string | null;
  title: string;
  startsAt: Date;
  endsAt: Date;
  status: 'ACTIVE' | 'CANCELLED';
  createdAt: Date;
  participants: MeetupParticipantRecord[];
}

// ---------- Avisos ----------

export type NotificationType = 'MESSAGE' | 'MEETUP_INVITE' | 'MEETUP_ACCEPTED' | 'MEETUP_CANCELLED' | 'GROUP_REMOVED' | 'FOLLOW_REQUEST' | 'FOLLOW_ACCEPTED' | 'FOLLOW_NEW' | 'FLASH_INVITE' | 'POST_TAG' | 'POST_LIKE' | 'POST_COMMENT' | 'VENUE_CLAIM' | 'EVENT_REMINDER' | 'VENUE_CALENDAR' | 'VENUE_EVENT' | 'FEED_PENDING' | 'FEED_APPROVED' | 'FEED_REJECTED' | 'FEED_COMMENT' | 'FEED_MENTION' | 'FEED_REACTION' | 'FEED_NOTICE' | 'VENUE_TEAM' | 'ALBUM_SUMMARY' | 'GUEST_LIST';

/** O que a pessoa silenciou no push (o aviso continua no sino). `all` vale para tudo; `chats` e `events` só para o seu grupo de avisos. */
export interface NotificationMuteSettings {
  all: boolean;
  chats: boolean;
  events: boolean;
}

/** Aviso guardado para a pessoa. `url` é um caminho dentro do app; `dedupeKey` evita avisos repetidos enquanto o anterior não foi lido. */
export interface NotificationRecord {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  url: string;
  dedupeKey: string | null;
  /** Quem causou o aviso (seguiu, curtiu, convidou...), para a tela mostrar a foto da pessoa. Avisos antigos não têm. */
  actorId?: string | null;
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
  /**
   * O app desse aparelho sabe mostrar o campo "Responder" na notificação. No Android isso muda o formato do push
   * (só dados, o app monta o aviso); versões antigas do app não mostrariam nada, então só vale quando o app avisa.
   */
  replyable?: boolean;
  /** O app desse aparelho tem os sons do AskouT (no Android, os canais de cada som). Versões antigas: só o som padrão. */
  sounds?: boolean;
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
  /** Tipo do evento (ícone da página). Só vale quando o post é um evento. */
  eventKind: EventKind;
  /** Evento privado: só o dono vê nas listas; os demais chegam por cartão numa conversa. */
  eventPrivate?: boolean;
  /** Respostas às configurações de evento da gestão ("Pode fumar?": sim). Só vale quando o post é um evento. */
  eventExtras?: EventExtraAnswer[];
  /** Arquivado: some do feed e do perfil, só a própria pessoa vê. */
  archivedAt: Date | null;
  editedAt: Date | null;
  createdAt: Date;
  /** Post publicado em nome de um estabelecimento (o autor é quem administra o local). */
  venueId?: string | null;
  /** Local do AskouT vinculado como rolê do post (o nome leva à página dele). */
  placeVenueId?: string | null;
  /** Evento vinculado ao post (id de um evento de local ou de um post que é evento). */
  linkedEventId?: string | null;
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
  /** Vídeo do item (a capa fica em `mime`/`data`). */
  videoMime?: string | null;
  videoData?: Uint8Array | null;
}

/** Imagem sem os bytes (a lista não carrega as fotos, só o endereço delas). */
export interface PostImageMeta {
  id: string;
  position: number;
  isUpload: boolean;
  placePhotoRef: string | null;
  placePhotoAuthor: string | null;
  /** Tem vídeo anexado (o tipo; os bytes não vêm nas listas). */
  videoMime?: string | null;
}

export interface PostWithImages {
  post: PostRecord;
  images: PostImageMeta[];
}

export interface PostCommentRecord {
  id: string;
  postId: string;
  authorId: string;
  body: string;
  createdAt: Date;
  /** Comentário feito como estabelecimento (quem administra comentando num post do próprio bar). */
  venueId?: string | null;
  /** GIF (Giphy) anexado: id e endereço em servidor da Giphy. O texto pode ficar vazio quando há GIF. */
  gifId?: string | null;
  gifUrl?: string | null;
  /** Resposta: o comentário de cima da conversa (um nível só). */
  parentId?: string | null;
}

export const POST_REPORT_REASONS = ['SPAM', 'OFFENSIVE', 'NUDITY', 'VIOLENCE', 'FALSE_INFO', 'OTHER'] as const;
export type PostReportReason = (typeof POST_REPORT_REASONS)[number];

export interface PostReportRecord {
  id: string;
  postId: string;
  reporterId: string;
  reason: PostReportReason;
  details: string | null;
  createdAt: Date;
  /** Preenchidos quando um admin decide a denúncia. */
  resolvedAt?: Date | null;
  resolvedBy?: string | null;
  resolution?: ReportResolution | null;
  resolutionNote?: string | null;
}

/** Como um admin encerrou uma denúncia: sem ação (DISMISSED) ou com providência (ACTIONED). */
export type ReportResolution = 'DISMISSED' | 'ACTIONED';
export const REPORT_RESOLUTIONS: readonly ReportResolution[] = ['DISMISSED', 'ACTIONED'];

/** Campos que a edição troca (a pessoa autora é quem edita). */
/** Qual evento: um do local (Explorar) ou um criado por uma pessoa (post com dados de evento). */
export interface EventRef {
  source: 'PLACE' | 'USER';
  id: string;
}

export interface EventAttendanceRecord {
  userId: string;
  createdAt: Date;
}

/** Onde fica um feed: evento do local, evento criado por uma pessoa ou a página de um rolê. */
export type FeedTargetType = 'PLACE_EVENT' | 'USER_EVENT' | 'VENUE';

export interface FeedTarget {
  type: FeedTargetType;
  id: string;
}

/** OPEN: quem vê a página publica. MODERATED: publica, mas só aparece depois que o dono aprova. OWNER_ONLY: só o dono. */
export type FeedPolicy = 'OPEN' | 'MODERATED' | 'OWNER_ONLY';
export type FeedPostKind = 'POST' | 'NOTICE';
export type FeedPostStatus = 'PUBLISHED' | 'PENDING';

export interface FeedPostRecord {
  id: string;
  target: FeedTarget;
  authorId: string;
  kind: FeedPostKind;
  body: string | null;
  status: FeedPostStatus;
  /** Publicado pelo dono do rolê, em nome do rolê. */
  asVenue: boolean;
  createdAt: Date;
  reviewedAt: Date | null;
}

/** A publicação com os ids das fotos, em ordem (sem os bytes). */
export interface FeedPostWithImages {
  post: FeedPostRecord;
  imageIds: string[];
}

export interface FeedImageInput {
  id: string;
  mime: string;
  data: Uint8Array;
}

export interface FeedCommentRecord {
  id: string;
  postId: string;
  authorId: string;
  body: string;
  createdAt: Date;
  /** GIF (Giphy) anexado; o texto pode ficar vazio quando há GIF. */
  gifId?: string | null;
  gifUrl?: string | null;
  /** Resposta: o comentário de cima da conversa (um nível só). */
  parentId?: string | null;
}

/** Denúncia de uma publicação ou de um comentário do feed. `evidence`: o texto como estava na hora. */
export interface FeedReportRecord {
  id: string;
  kind: 'POST' | 'COMMENT';
  postId: string;
  commentId: string | null;
  reporterId: string;
  reportedUserId: string;
  reason: PostReportReason;
  details: string | null;
  evidence: string;
  createdAt: Date;
  resolvedAt?: Date | null;
  resolvedBy?: string | null;
  resolution?: ReportResolution | null;
  resolutionNote?: string | null;
}

/** Reações de uma publicação ou comentário: quantas de cada emoji e a minha. */
export interface FeedReactionStats {
  id: string;
  counts: { emoji: string; count: number }[];
  mine: string | null;
}

/** Posição na lista (mais recente primeiro): o par data + id do último item visto. */
export interface FeedCursor {
  createdAt: Date;
  id: string;
}

/** Story de evento: foto ou vídeo. Vale 24 h ou até o fim do evento, o que vier primeiro. */
export interface EventStoryRecord {
  id: string;
  ref: EventRef;
  userId: string;
  mime: string;
  video: boolean;
  /** Também no perfil: os amigos veem na página inicial. Sem o campo, fica só no evento. */
  onProfile?: boolean;
  /** Textos e figurinhas por cima da mídia (desenhados por quem assiste). Sem o campo, nenhum. */
  overlays?: StoryOverlay[];
  /** Texto por cima da mídia e a altura dele na tela (0 = topo, 1 = pé). */
  caption?: string | null;
  captionY?: number | null;
  data: Uint8Array;
  createdAt: Date;
  expiresAt: Date;
}

export interface EventStoryReportRecord {
  id: string;
  storyId: string;
  reporterId: string;
  reason: PostReportReason;
  details: string | null;
  createdAt: Date;
  resolvedAt?: Date | null;
  resolvedBy?: string | null;
  resolution?: ReportResolution | null;
  resolutionNote?: string | null;
}

export type EventStoryMeta = Omit<EventStoryRecord, 'data'>;

export interface PostPatch {
  caption: string | null;
  placeName: string | null;
  placeAddress: string | null;
  placeVenueId?: string | null;
  /** Sem o campo, o evento vinculado não muda. */
  linkedEventId?: string | null;
  eventTitle: string | null;
  eventStartsAt: Date | null;
  eventEndsAt: Date | null;
  eventKind: EventKind;
  /** Sem o campo, as respostas não mudam. */
  eventExtras?: EventExtraAnswer[];
  /** Sem o campo, "quem vê" não muda. */
  eventPrivate?: boolean;
  editedAt: Date;
}

/** Filtros extras das listas: só arquivados, ou sem o que `hideFor` marcou como "não tenho interesse". */
export interface PostScope {
  archived?: boolean;
  hideFor?: string;
  /** Inclui também os posts feitos em nome destes estabelecimentos (os que a pessoa segue, ou o da página). */
  venueIds?: string[];
  /** Só posts criados antes deste instante (a régua de datas do Início). */
  before?: Date;
}

/** Só eventos (posts com dados de evento) ou só posts comuns. */
export type PostKindFilter = 'EVENT' | 'POST';

export type PostTagStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED';

/** Convite para um evento criado por uma pessoa. `invitedById` nulo: quem convidou apagou a conta. */
export interface EventInviteRecord {
  postId: string;
  userId: string;
  invitedById: string | null;
  createdAt: Date;
}

export interface PostTagRecord {
  postId: string;
  userId: string;
  status: PostTagStatus;
  createdAt: Date;
}

/** Ocultação do Flash entre duas pessoas, do ponto de vista de `ownerId`. Cada pessoa tem a sua linha. */
export interface FlashHiddenRecord {
  ownerId: string;
  otherId: string;
  /** `ownerId` não vê o Flash de `otherId`. */
  hideTheirs: boolean;
  /** `otherId` não vê o Flash de `ownerId`. */
  hideMine: boolean;
}

/** Ocultação de stories entre duas pessoas, do ponto de vista de `ownerId` (mesma ideia do Flash). */
export interface StoryHiddenRecord {
  ownerId: string;
  otherId: string;
  /** `ownerId` não vê os stories de `otherId`. */
  hideTheirs: boolean;
  /** `otherId` não vê os stories de `ownerId`. */
  hideMine: boolean;
}

/** Denúncia de uma conversa (1 a 1 ou grupo). `evidence` guarda as últimas mensagens de texto, só para a análise da equipe. */
export interface ConversationReportRecord {
  id: string;
  conversationId: string;
  reporterId: string;
  /** Na conversa 1 a 1, a pessoa denunciada; no grupo, nulo. */
  reportedUserId: string | null;
  reason: PostReportReason;
  details: string | null;
  evidence: string;
  createdAt: Date;
  resolvedAt?: Date | null;
  resolvedBy?: string | null;
  resolution?: ReportResolution | null;
  resolutionNote?: string | null;
}

// ---------- Gestão (painel admin) ----------

export interface AdminStats {
  users: number;
  suspendedUsers: number;
  venues: number;
  venuesWithOwner: number;
  placeEvents: number;
  userEvents: number;
  posts: number;
  pendingClaims: number;
  approvedClaims: number;
  openPostReports: number;
  openConversationReports: number;
  openUserReports: number;
  openStoryReports: number;
  openFeedReports: number;
  pendingFeedPosts: number;
}

export interface AdminUserRow {
  id: string;
  email: string;
  username: string;
  displayName: string;
  status: UserStatus;
  role: UserRole;
  createdAt: Date;
  postsCount: number;
  /** Denúncias recebidas (em posts da pessoa e em conversas). */
  reportsCount: number;
  /** Data de nascimento (AAAA-MM-DD) para a gestão conferir idade; null se ainda não informou. */
  birthDate: string | null;
  /** Contas de outra plataforma ligadas (Google, Apple), em ordem alfabética; vazio se só usa e-mail e senha. */
  loginProviders: ExternalProvider[];
}

export interface AdminVenueRow {
  id: string;
  name: string;
  address: string | null;
  category: string | null;
  isSample: boolean;
  owner: { id: string; username: string } | null;
  eventsCount: number;
}

export interface AdminPlaceEventRow {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  kind: EventKind;
  isSample: boolean;
  isFree: boolean;
  venue: { id: string; name: string; address: string | null };
}

export interface AdminPostRow {
  id: string;
  caption: string | null;
  author: { id: string; username: string };
  imagesCount: number;
  firstImageId: string | null;
  eventTitle: string | null;
  eventStartsAt: Date | null;
  archived: boolean;
  reportsCount: number;
  createdAt: Date;
}

/** Pessoa nas listas ligadas de um detalhe da gestão (amigos, seguidores, confirmados...), com a data do vínculo. */
export interface AdminPersonRef {
  id: string;
  username: string;
  displayName: string;
  at: Date;
}

/** Pessoa ligada a um evento na gestão (confirmou "Eu vou" ou foi convidada), com a foto de perfil. */
export interface AdminEventPerson extends AdminPersonRef {
  avatarUrl: string | null;
}

/** Convidado de um evento criado por pessoa que ainda não confirmou, com quem convidou. */
export interface AdminEventInvitee extends AdminEventPerson {
  invitedBy: { id: string; username: string } | null;
}

/**
 * Tudo o que a gestão vê de uma pessoa além da linha da lista: o cadastro inteiro (menos a senha e o hash do celular),
 * as configurações, as contagens dos vínculos e as listas ligadas (amigos, seguidores, eventos, posts, locais).
 */
export interface AdminUserExtras {
  updatedAt: Date;
  termsAcceptedAt: Date | null;
  termsVersion: string | null;
  onboardedAt: Date | null;
  tastes: string[];
  profilePending: boolean;
  passwordless: boolean;
  phone: string | null;
  phoneVerifiedAt: Date | null;
  avatarUrl: string | null;
  isPrivate: boolean;
  mfaEnabled: boolean;
  settings: { timeZone: string; shareAvailability: boolean; openDms: boolean } | null;
  region: { lat: number; lng: number; updatedAt: Date } | null;
  invitedBy: { id: string; username: string } | null;
  /** Contas Google/Apple ligadas. */
  loginProviders: ExternalProvider[];
  counts: {
    friends: number; followers: number; following: number; followRequests: number;
    posts: number; eventsCreated: number; eventsGoing: number; feedPosts: number; postComments: number; postLikes: number; stories: number;
    venuesFollowed: number; venuesOwned: number; venuesManaged: number; claims: number;
    reportsMade: number; reportsReceived: number; blocksMade: number; blockedBy: number;
    groups: number; conversations: number; messages: number; referrals: number;
  };
  /** Amigos: seguem um ao outro (até 50, os mais recentes primeiro). */
  friends: AdminPersonRef[];
  followers: AdminPersonRef[];
  following: AdminPersonRef[];
  /** Pedidos para seguir ainda sem resposta (perfil privado). */
  followRequests: AdminPersonRef[];
  /** Eventos criados pela pessoa (posts com dados de evento), os mais novos primeiro. */
  eventsCreated: { id: string; title: string; startsAt: Date | null; endsAt: Date | null; private: boolean; createdAt: Date }[];
  /** Presenças confirmadas ("Eu vou"), as mais recentes primeiro. */
  eventsGoing: { id: string; source: 'PLACE' | 'USER'; title: string; startsAt: Date | null; venueName: string | null; at: Date }[];
  posts: { id: string; caption: string | null; eventTitle: string | null; archived: boolean; createdAt: Date }[];
  venues: { id: string; name: string; role: 'OWNER' | 'MANAGER' | 'FOLLOWER' }[];
  claims: { id: string; venueId: string; venueName: string; status: ClaimStatus; createdAt: Date }[];
  groups: { id: string; name: string; role: string; joinedAt: Date }[];
}

/**
 * Números de uma pessoa para quem modera e gerencia o app (o botão "Atividade" da lista de pessoas). Só contagens e
 * datas: nunca o texto de mensagens nem com quem a pessoa conversa.
 */
export interface AdminUserStats {
  /**
   * Última vez que a pessoa fez algo no app (publicou, curtiu, comentou, mandou mensagem, confirmou presença, seguiu,
   * ligou o NOW ou viu um conteúdo). O app não grava cada login, então é o melhor sinal de "último acesso".
   */
  lastSeenAt: Date | null;
  accountAgeDays: number;
  /** Dias diferentes (fuso de Brasília) com alguma ação ou visualização nos últimos 30 dias. */
  activeDays30: number;
  /** Ações (posts, comentários, curtidas, reações, mensagens, presenças, quem seguiu, stories, NOW) nos últimos 7 e 30 dias. */
  actions7: number;
  actions30: number;
  social: { friends: number; followers: number; following: number; followersGained30: number; likesReceived: number; commentsReceived: number };
  content: { posts: number; stories: number; feedPosts: number; comments: number; likes: number };
  events: { created: number; going: number; checkins: number; invitesSent: number; invitesReceived: number; datePolls: number; cloakroomTickets: number };
  now: { sessions: number; sessions30: number; lastAt: Date | null; invitesSent: number; invitesReceived: number; meetups: number; hiddenBy: number };
  messages: { conversations: number; sent: number; sent30: number };
  moderation: {
    /** Denúncias contra a pessoa ou o que ela publicou (perfil, comentário, post, feed, story, conversa). */
    reportsReceived: number;
    reportsOpen: number;
    /** Decididas pela gestão com providência tomada. */
    reportsActioned: number;
    reportsMade: number;
    reportsMadeActioned: number;
    blockedBy: number;
    blocksMade: number;
    suspensions: number;
    lastSuspendedAt: Date | null;
  };
  purchases: { boostsPaid: number; spentCents: number; lastPaidAt: Date | null; boostsPending: number };
  referrals: { invited: number; qualified: number };
}

/** O que a gestão vê de um local além do que o app já mostra. */
export interface AdminVenueExtras {
  createdAt: Date;
  updatedAt: Date;
  externalKey: string | null;
  photoRef: string | null;
  photoAuthor: string | null;
  hoursJson: string | null;
  feedPolicy: FeedPolicy;
  rating: { count: number; average: number | null };
  counts: { checkins: number; posts: number; feedPosts: number; stories: number; claims: number; offers: number; boosts: number; conversations: number };
  managers: { id: string; username: string; displayName: string; status: 'PENDING' | 'ACCEPTED'; at: Date }[];
  claims: { id: string; userId: string; username: string; status: ClaimStatus; createdAt: Date; reviewedAt: Date | null }[];
  followersSample: AdminPersonRef[];
}

/** O que a gestão vê de um evento de local além do cadastro. */
export interface AdminPlaceEventExtras {
  createdAt: Date;
  updatedAt: Date;
  feedPolicy: FeedPolicy;
  counts: { stories: number; feedPosts: number; meetings: number; posts: number; cloakroomTickets: number };
  hunterRef: string | null;
  cloakroom: { enabled: boolean; priceCents: number | null; capacity: number | null } | null;
  guestList: { limit: number | null; closesAt: Date | null; maxCompanions: number } | null;
}

/** Um post inteiro para a gestão (sem os bytes das fotos). */
export interface AdminPostDetail {
  id: string;
  caption: string | null;
  author: { id: string; username: string; displayName: string };
  placeName: string | null;
  placeAddress: string | null;
  eventTitle: string | null;
  eventStartsAt: Date | null;
  eventEndsAt: Date | null;
  eventKind: EventKind;
  eventPrivate: boolean;
  feedPolicy: FeedPolicy;
  archivedAt: Date | null;
  editedAt: Date | null;
  createdAt: Date;
  venue: { id: string; name: string } | null;
  placeVenue: { id: string; name: string } | null;
  linkedEventId: string | null;
  images: { id: string; uploaded: boolean }[];
  tagged: AdminPersonRef[];
  /** Evento: quem confirmou "Eu vou" (os primeiros 50, na ordem da confirmação; o total está em `counts.attendees`). */
  going: AdminEventPerson[];
  /** Evento: convidados que ainda não confirmaram (os primeiros 50, na ordem do convite). */
  invitedPending: AdminEventInvitee[];
  /** Quantos convidados ainda não confirmaram. */
  invitedPendingCount: number;
  counts: { likes: number; comments: number; reports: number; attendees: number; invites: number; stories: number; feedPosts: number; reposts: number };
  recentComments: { id: string; username: string; body: string; createdAt: Date }[];
}

export interface AdminPostReportRow {
  id: string;
  reason: PostReportReason;
  details: string | null;
  createdAt: Date;
  reporter: { id: string; username: string };
  post: AdminPostRow;
  resolvedAt: Date | null;
  resolution: ReportResolution | null;
  resolutionNote: string | null;
}

export interface AdminStoryReportRow {
  id: string;
  reason: PostReportReason;
  details: string | null;
  createdAt: Date;
  reporter: { id: string; username: string };
  story: { id: string; kind: 'IMAGE' | 'VIDEO'; caption: string | null; author: { id: string; username: string }; eventId: string; eventTitle: string | null; createdAt: Date; expiresAt: Date; reportsCount: number };
  resolvedAt: Date | null;
  resolution: ReportResolution | null;
  resolutionNote: string | null;
}

/** Onde fica a publicação do feed, para a gestão abrir a página. */
export interface AdminFeedPlace {
  type: FeedTargetType;
  id: string;
  title: string;
  /** Caminho da página no app (ex.: `/eventos/<id>`). */
  url: string;
}

/** Publicação do feed vista pela gestão (de qualquer evento ou rolê). */
export interface AdminFeedPostRow {
  id: string;
  kind: FeedPostKind;
  status: FeedPostStatus;
  body: string | null;
  createdAt: Date;
  author: { id: string; username: string };
  place: AdminFeedPlace;
  imageIds: string[];
  commentsCount: number;
  openReportsCount: number;
}

export interface AdminFeedCommentRow {
  id: string;
  postId: string;
  body: string;
  /** GIF anexado ao comentário (a gestão vê junto do texto). */
  gifUrl: string | null;
  createdAt: Date;
  author: { id: string; username: string };
  openReportsCount: number;
}

export interface AdminFeedReportRow {
  id: string;
  kind: 'POST' | 'COMMENT';
  reason: PostReportReason;
  details: string | null;
  evidence: string;
  createdAt: Date;
  reporter: { id: string; username: string };
  reported: { id: string; username: string; status: UserStatus };
  /** A publicação (a denunciada, ou a do comentário denunciado). `null` se já foi apagada. */
  post: AdminFeedPostRow | null;
  /** O comentário denunciado ainda existe. */
  commentId: string | null;
  commentAlive: boolean;
  resolvedAt: Date | null;
  resolution: ReportResolution | null;
  resolutionNote: string | null;
}

/** Denúncia de perfil ou de comentário. */
export interface UserReportRecord {
  id: string;
  kind: 'PROFILE' | 'COMMENT';
  reporterId: string;
  reportedUserId: string;
  commentId: string | null;
  /** Separa registros do mesmo par (ex.: o aviso automático de bloqueio não sobrescreve uma denúncia feita antes). */
  variant?: string;
  /** O texto denunciado (nome, descrição ou comentário) como estava no momento da denúncia. */
  evidence: string;
  reason: PostReportReason;
  details: string | null;
  createdAt: Date;
}

export interface AdminUserReportRow {
  id: string;
  kind: 'PROFILE' | 'COMMENT';
  /** Comentário de post denunciado (kind COMMENT); null se for perfil. */
  commentId: string | null;
  /** O comentário ainda existe (dá para apagar pela gestão). */
  commentExists: boolean;
  reason: PostReportReason;
  details: string | null;
  evidence: string;
  createdAt: Date;
  reporter: { id: string; username: string };
  reported: { id: string; username: string; status: UserStatus };
  resolvedAt: Date | null;
  resolution: ReportResolution | null;
  resolutionNote: string | null;
}

export interface AdminConversationReportRow {
  id: string;
  conversationId: string;
  reason: PostReportReason;
  details: string | null;
  /** O que a pessoa que denunciou enviou junto (trecho da conversa). */
  evidence: string;
  createdAt: Date;
  reporter: { id: string; username: string };
  reported: { id: string; username: string; status: UserStatus } | null;
  resolvedAt: Date | null;
  resolution: ReportResolution | null;
  resolutionNote: string | null;
}

export type AuditAction =
  | 'USER_SUSPENDED'
  | 'USER_REACTIVATED'
  | 'USER_BIRTHDATE_CHANGED'
  | 'USER_PROFILE_EDITED'
  | 'CLAIM_APPROVED'
  | 'CLAIM_REJECTED'
  | 'VENUE_OWNER_REMOVED'
  | 'VENUE_EDITED'
  | 'PLACE_EVENT_EDITED'
  | 'POST_REMOVED'
  | 'PLACE_EVENT_REMOVED'
  | 'STORY_REMOVED'
  | 'FEED_POST_REMOVED'
  | 'FEED_COMMENT_REMOVED'
  | 'COMMENT_REMOVED'
  | 'REPORT_DISMISSED'
  | 'REPORT_ACTIONED'
  | 'PAYMENTS_ENABLED'
  | 'PAYMENTS_DISABLED'
  | 'BOOST_PACKAGES_UPDATED'
  | 'EVENT_EXTRA_CREATED'
  | 'EVENT_EXTRA_UPDATED'
  | 'EVENT_EXTRA_REMOVED'
  | 'TASTE_CREATED'
  | 'TASTE_UPDATED'
  | 'TASTE_REMOVED'
  | 'RECO_EXPERIMENT_ENABLED'
  | 'RECO_EXPERIMENT_CHANGED'
  | 'RECO_EXPERIMENT_DISABLED';

export interface AuditRecord {
  id: string;
  adminId: string;
  action: AuditAction;
  targetType: 'USER' | 'CLAIM' | 'VENUE' | 'POST' | 'PLACE_EVENT' | 'POST_REPORT' | 'CONVERSATION_REPORT' | 'USER_REPORT' | 'STORY' | 'STORY_REPORT' | 'FEED_POST' | 'FEED_COMMENT' | 'FEED_REPORT' | 'COMMENT' | 'SETTING';
  targetId: string;
  note: string | null;
  createdAt: Date;
}

export interface AuditRow extends AuditRecord {
  adminUsername: string;
}

// ---------- Votação de datas ("Encontrar a melhor data") ----------

export type PollStatus = 'VOTING' | 'CONFIRMING' | 'FINALIZED' | 'CANCELLED';
export type PollProposalStatus = 'OPEN' | 'CONFIRMED' | 'REJECTED' | 'WITHDRAWN';

export interface PollRecord {
  id: string;
  conversationId: string;
  organizerId: string;
  title: string;
  /** BEST_DATE: vota os dias (hora fixa). BEST_TIME: o dia já está definido (início = fim) e vota os horários de `candidateTimes`. BEST_DATE_TIME: vota os dias e os horários. */
  schedulingMode: 'BEST_DATE' | 'BEST_TIME' | 'BEST_DATE_TIME';
  /** Horários (HH:MM, em ordem) votados em BEST_TIME e BEST_DATE_TIME; vazio (ou ausente) no BEST_DATE. */
  candidateTimes?: string[];
  /** Dias do calendário (AAAA-MM-DD) no fuso `timezone`. */
  rangeStart: string;
  rangeEnd: string;
  durationMinutes: number;
  /** Início preferido (HH:MM); nulo = 19:00. */
  preferredTimeStart: string | null;
  timezone: string;
  votingDeadline: Date | null;
  /** Quem organiza encerrou os votos antes do prazo. */
  votingClosedAt?: Date | null;
  /** Quando o aviso de prazo encerrado foi enviado. */
  deadlineNotifiedAt?: Date | null;
  confirmationPolicy: 'UNANIMITY' | 'MAJORITY' | 'MANUAL';
  greenMin: number;
  orangeMin: number;
  minCoverage: number;
  status: PollStatus;
  finalProposalId: string | null;
  meetupId: string | null;
  /** Evento (post) criado a partir desta votação. */
  eventPostId?: string | null;
  createdAt: Date;
}

export interface PollParticipantRecord {
  userId: string;
  finishedAt: Date | null;
}

export interface PollVoteRecord {
  userId: string;
  date: string;
  status: 'YES' | 'MAYBE' | 'NO';
}

export interface PollProposalRecord {
  id: string;
  pollId: string;
  candidateDate: string;
  candidateStartAt: Date;
  candidateEndAt: Date;
  compatibilityScore: number | null;
  coverageScore: number;
  availableCount: number;
  maybeCount: number;
  unavailableCount: number;
  unansweredCount: number;
  status: PollProposalStatus;
  createdAt: Date;
}

export interface PollConfirmationRecord {
  userId: string;
  status: 'CONFIRMED' | 'ADJUST' | 'DECLINED';
  respondedAt: Date;
}

/** Texto guardado no lugar do conteúdo de uma mensagem apagada (o banco exige 1 a 2000 caracteres no corpo). A visão da API nunca o mostra. */
export const DELETED_BODY = 'Mensagem apagada';

// ---------- Impulsionamento (anúncio pago por quem administra o local) ----------

/** O que é impulsionado: a página do local ou um evento dele. */
export type BoostTarget = 'VENUE' | 'EVENT';

/** Estado guardado. “Ativo”, “agendado” e “encerrado” são deduzidos de `startsAt`/`endsAt` e do relógio. */
export type BoostStatus = 'PENDING_PAYMENT' | 'PAID' | 'CANCELLED' | 'PAUSED';

/**
 * Para quem o anúncio aparece. ALL: destaque para todo mundo (Explorar e Home).
 * MATCH: só para quem mora no raio escolhido E tem o gosto validado por uma das hashtags escolhidas.
 */
export type BoostAudience = 'ALL' | 'MATCH';

/**
 * Por onde o pedido é pago. WEB: Pix ou cartão no provedor de pagamento (sem comissão das lojas).
 * APPLE e GOOGLE: compra dentro do app, obrigatória nas lojas para bens digitais; o recibo é conferido no servidor.
 */
export type BoostChannel = 'WEB' | 'APPLE' | 'GOOGLE';

/** O que o relatório do anúncio conta: viu o cartão patrocinado, abriu, ou tocou em "Comprar ingresso" depois de ver. */
export type BoostStatKind = 'IMPRESSION' | 'OPEN' | 'TICKET';

/** Onde o anúncio foi visto: Explorar, Home ("Rolês em destaque"), Match no "Para você" ou a página do evento (ingresso). */
export type BoostPlacement = 'EXPLORE' | 'HOME' | 'MATCH' | 'EVENT_PAGE';

/** Contador do relatório do anúncio: só números, nunca quem. `day` é a data no fuso de Brasília (AAAA-MM-DD). */
export interface BoostStatRow {
  boostId: string;
  day: string;
  placement: BoostPlacement;
  kind: BoostStatKind;
  count: number;
}

export interface BoostRecord {
  id: string;
  venueId: string;
  channel: BoostChannel;
  /** Quem pediu e pagou (o responsável pelo local). */
  ownerId: string;
  target: BoostTarget;
  /** Só quando `target` é EVENT: o evento do local. */
  eventId: string | null;
  days: number;
  /** Valor total em centavos de real. */
  amountCents: number;
  status: BoostStatus;
  /** Identificador da cobrança no provedor de pagamento. */
  chargeId: string | null;
  /** Pix copia e cola e/ou link de pagamento, enquanto aguarda. */
  payCode: string | null;
  payUrl: string | null;
  createdAt: Date;
  paidAt: Date | null;
  /** Só depois de pago: a janela em que o anúncio aparece. */
  startsAt: Date | null;
  endsAt: Date | null;
  audience: BoostAudience;
  /** Só no Match: raio, em metros, em volta do local. */
  radiusM: number | null;
  /** Só no Match: hashtags (do evento) que o responsável quer alcançar. */
  matchTags: string[];
}

/**
 * Região aproximada de quem mora na cidade, dada pela própria pessoa para receber o Match.
 * Coordenada arredondada (cerca de 1 km): nunca a posição exata. Apagar a linha desliga o Match.
 */
export interface RegionRecord {
  userId: string;
  lat: number;
  lng: number;
  updatedAt: Date;
}

// ---------- Recomendação ----------

export type DwellTarget = 'POST' | 'EVENT';
/** De onde veio a exibição: feed normal, bloco "Para você" ou outro lugar. */
export type DwellSource = 'FEED' | 'RECO' | 'OTHER';

/** Quanto tempo um conteúdo ficou visível na tela da pessoa (uma medição). */
export interface DwellRecord {
  id: string;
  userId: string;
  targetType: DwellTarget;
  targetId: string;
  /** Milissegundos visível. */
  ms: number;
  source: DwellSource;
  /** A pessoa abriu o conteúdo a partir daqui (clique no bloco "Para você"). */
  clicked?: boolean;
  /** A pessoa compartilhou o conteúdo (conversa, fora do app ou no próprio perfil). */
  shared?: boolean;
  createdAt: Date;
}

/** Curtida ou comentário de uma pessoa num post. */
export interface EngagementRow {
  postId: string;
  kind: 'LIKE' | 'COMMENT';
  at: Date;
}

/** Uma mensagem numa conversa 1 a 1: só quando, com quem e quem mandou. Nunca o conteúdo. */
export interface DirectActivityRow {
  otherId: string;
  at: Date;
  /** Foi a própria pessoa quem mandou. */
  mine: boolean;
}

/** Agenda (iCal / Google Agenda) ligada a um estabelecimento. O endereço é segredo de quem administra: nunca sai inteiro nas respostas. */
export interface VenueCalendarRecord {
  venueId: string;
  url: string;
  /** Com quantos dias de antecedência o evento sobe (1 a 30). */
  leadDays: number;
  enabled: boolean;
  lastSyncAt: Date | null;
  /** Mensagem da última tentativa que falhou; null quando a última deu certo. */
  lastError: string | null;
  /** Quantos eventos futuros a última leitura encontrou. */
  lastFound: number;
  createdAt: Date;
}

/** WAITING: ainda longe; AWAITING: dono avisado, falta decidir; APPROVED: sobe na data; PUBLISHED: virou evento; DISMISSED: dispensado ou vencido. */
export type CalendarDraftStatus = 'WAITING' | 'AWAITING' | 'APPROVED' | 'PUBLISHED' | 'DISMISSED';

/** Evento lido da agenda, esperando a aprovação do dono para virar evento do local. */
export interface CalendarDraftRecord {
  id: string;
  venueId: string;
  /** Identifica a ocorrência na agenda: `uid|início original`. Único por local. */
  occKey: string;
  title: string;
  description: string;
  startsAt: Date;
  endsAt: Date;
  kind: EventKind;
  isFree: boolean;
  imageUrl: string | null;
  tags: string[];
  ticketUrl: string | null;
  /** Quando o evento sobe: início menos os dias de antecedência. */
  publishAt: Date;
  status: CalendarDraftStatus;
  /** O dono mexeu: a agenda não sobrescreve mais. */
  edited: boolean;
  notifiedAt: Date | null;
  publishedEventId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ---------- Registro de atividades (o que a própria pessoa fez) ----------

/** Grupos dos chips da tela "Suas interações". */
export const ACTIVITY_KINDS = ['LIKE', 'COMMENT', 'POST', 'FOLLOW', 'EVENT'] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/** O que a pessoa fez. */
export type ActivityAction =
  /** Curtiu um post (ou um evento criado por alguém). */
  | 'POST_LIKE'
  /** Reagiu com emoji a uma publicação no feed de um evento ou local. */
  | 'FEED_REACTION'
  | 'POST_COMMENT'
  | 'FEED_COMMENT'
  | 'POST_CREATED'
  | 'EVENT_CREATED'
  /** Publicou no feed de um evento ou local. */
  | 'FEED_POST'
  /** Confirmou presença ("Eu vou"). */
  | 'EVENT_GOING'
  /** Passou a seguir (ou pediu para seguir) uma pessoa. */
  | 'FOLLOW_USER'
  | 'FOLLOW_VENUE';

/** Para onde o item leva no app. */
export interface ActivityTarget {
  type: 'POST' | 'USER_EVENT' | 'PLACE_EVENT' | 'VENUE' | 'USER';
  id: string;
}

/** Uma linha do registro, como o banco devolve. */
export interface ActivityRecord {
  /** Único no registro da pessoa (ex.: `like:<postId>`). Desempata a ordem. */
  id: string;
  action: ActivityAction;
  at: Date;
  target: ActivityTarget;
  /** Dono do conteúdo de origem (autor do post, pessoa seguida). null em evento ou local. */
  ownerId: string | null;
  /** Título do evento, nome do local ou começo da legenda do post de origem. */
  title: string | null;
  /** O que a pessoa escreveu (comentário, publicação, legenda) ou o emoji da reação. */
  text: string | null;
  /** O conteúdo existe mas não está mais visível (post arquivado por quem publicou). */
  hidden: boolean;
  /** Pedido para seguir ainda não aceito. */
  pending: boolean;
}

/** Chapelaria do evento: configuração de quem organiza. Sem registro, o evento não tem chapelaria. */
export interface CloakroomSettingRecord {
  placeEventId: string;
  enabled: boolean;
  /** Preço por item, em centavos (cobrado na porta, fora do app). Nulo: grátis. */
  priceCents: number | null;
  /** Máximo de itens guardados ao mesmo tempo. Nulo: sem limite. */
  capacity: number | null;
  note: string | null;
}

/** ISSUED: ticket emitido, itens ainda não entregues. STORED: itens guardados. RETURNED: retirados. CANCELED: desistiu antes de entregar. */
export type CloakroomStatus = 'ISSUED' | 'STORED' | 'RETURNED' | 'CANCELED';

export interface CloakroomTicketRecord {
  id: string;
  placeEventId: string;
  userId: string;
  /** Número sequencial no evento (etiqueta física). */
  number: number;
  /** Código curto, único no evento, que a equipe digita ou lê do QR. */
  code: string;
  description: string;
  itemCount: number;
  status: CloakroomStatus;
  createdAt: Date;
  storedAt: Date | null;
  returnedAt: Date | null;
}

// ---------- Oferta relâmpago do bar ----------

/** Oferta curta publicada por quem administra o local ("chopp em dobro até 22h"). Aparece como "Patrocinado" para quem está perto. */
export interface VenueOfferRecord {
  id: string;
  venueId: string;
  /** Quem publicou (o responsável pelo local). */
  ownerId: string;
  text: string;
  createdAt: Date;
  startsAt: Date;
  endsAt: Date;
  /** Preenchido quando o responsável encerra antes do fim. */
  endedAt: Date | null;
}

/** Lista VIP de um evento de local: ligada por quem administra o local, sem pagamento. */
export interface GuestListRecord {
  eventId: string;
  /** Quantos nomes cabem (sem contar acompanhantes). Nulo: sem limite. */
  limit: number | null;
  /** Depois deste horário ninguém entra nem muda o nome. Nulo: até o fim do evento. */
  closesAt: Date | null;
  /** Quantos acompanhantes cada pessoa pode levar (0 a 5). */
  maxCompanions: number;
  createdAt: Date;
}

export interface GuestListEntryRecord {
  eventId: string;
  userId: string;
  companions: number;
  /** Quando o dono marcou que a pessoa entrou. */
  checkedInAt: Date | null;
  createdAt: Date;
}

/** Lista de compras e divisão de gastos de um evento criado por uma pessoa. Existe só quando quem criou o evento liga. */
export interface EventShoppingRecord {
  eventPostId: string;
  /** Quem participa (sem administrar) pode criar e acrescentar itens na lista. */
  membersCanAdd: boolean;
  /** Quem participa (sem administrar) pode marcar um item como comprado. */
  membersCanCheck: boolean;
  /** Quem fica fora da divisão dos gastos (por padrão todo mundo do grupo entra). */
  splitExcludedIds: string[];
  createdAt: Date;
}

export interface ShoppingItemRecord {
  id: string;
  eventPostId: string;
  title: string;
  /** Texto livre: "2 kg", "3 pacotes". */
  quantity: string | null;
  createdById: string;
  boughtById: string | null;
  boughtAt: Date | null;
  createdAt: Date;
}

/** Um gasto da divisão: normalmente um anexo (nota fiscal, recibo); quem administra informa o valor e quem pagou. */
export interface EventExpenseRecord {
  id: string;
  eventPostId: string;
  uploaderId: string;
  /** Nome do anexo. Nulo: gasto lançado sem anexo. */
  fileName: string | null;
  mime: string | null;
  size: number;
  /** Valor em centavos. Nulo: ainda sem valor (não entra na conta). */
  amountCents: number | null;
  payerId: string | null;
  note: string | null;
  createdAt: Date;
}
