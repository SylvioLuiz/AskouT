import { AvailabilityService } from './availability-service.ts';
import { AuthService } from './auth-service.ts';
import { BlockService } from './block-service.ts';
import { FlashService } from './flash-service.ts';
import { ConversationService } from './conversation-service.ts';
import { FollowService } from './follow-service.ts';
import { MeetupService } from './meetup-service.ts';
import { SchedulingService } from './scheduling-service.ts';
import { ProfileEventService } from './profile-event-service.ts';
import { PostService } from './post-service.ts';
import { EventPageService } from './event-page-service.ts';
import { EventReminderService } from './event-reminder-service.ts';
import { ExploreService } from './explore-service.ts';
import { VenueService } from './venue-service.ts';
import { CalendarImportService } from './calendar-import-service.ts';
import { BoostService } from './boost-service.ts';
import { AdminService } from './admin-service.ts';
import { SuggestionService } from './suggestion-service.ts';
import { DwellService } from './dwell-service.ts';
import { InterestService } from './interest-service.ts';
import { MatchService } from './match-service.ts';
import { PaymentsSwitch } from './payments-switch.ts';
import { RegionService } from './region-service.ts';
import { AccountService } from './account-service.ts';
import { AgeService } from './age-service.ts';
import { RecommendationService } from './recommendation-service.ts';
import type { CoreDeps, NotificationRepository, PushSender, PushSubscriptionRepository } from './ports.ts';
import { NotificationService, StoredNotifier } from './notification-service.ts';
import { ProfileService } from './profile-service.ts';

export type CoreInput = Omit<CoreDeps, 'notifier'> & {
  /** Valor do impulsionamento por dia, em centavos. */
  boostPricePerDayCents?: number;
  /** Valor por dia na compra dentro do app (tabela de preços da loja), em centavos. Padrão: o mesmo da web. */
  boostStorePricePerDayCents?: number;
  /** Valor inicial da chave de pagamento, até a gestão escolher pelo painel. Padrão: ligada (a configuração do servidor define o valor real). */
  boostsEnabled?: boolean;
  notifications: NotificationRepository;
  pushSubscriptions: PushSubscriptionRepository;
  push: PushSender;
};

export function createCore(input: CoreInput) {
  const notifier = new StoredNotifier(input);
  const deps: CoreDeps = { ...input, notifier };
  const flash = new FlashService(deps);
  const profiles = new ProfileService(deps);
  const venues = new VenueService(deps);
  const auth = new AuthService(deps);
  const posts = new PostService(deps, profiles);
  const interests = new InterestService(deps);
  const match = new MatchService(deps, interests);
  const paymentsSwitch = new PaymentsSwitch(deps, input.boostsEnabled ?? true);
  const boosts = new BoostService(
    deps,
    {
      ...(input.boostPricePerDayCents === undefined ? {} : { pricePerDayCents: input.boostPricePerDayCents }),
      ...(input.boostStorePricePerDayCents === undefined ? {} : { storePricePerDayCents: input.boostStorePricePerDayCents }),
    },
    match,
    paymentsSwitch,
  );
  return {
    boosts,
    auth,
    profiles,
    follows: new FollowService(deps),
    blocks: new BlockService(deps),
    availability: new AvailabilityService(deps),
    flash,
    conversations: new ConversationService(deps),
    suggestions: new SuggestionService(deps, flash),
    explore: new ExploreService(deps, profiles, boosts),
    eventPages: new EventPageService(deps, profiles),
    eventReminders: new EventReminderService(deps),
    venues,
    calendarImport: new CalendarImportService(deps, venues),
    admin: new AdminService(deps, venues, auth, paymentsSwitch),
    meetups: new MeetupService(deps),
    scheduling: new SchedulingService(deps),
    profileEvents: new ProfileEventService(deps, profiles),
    posts,
    dwell: new DwellService(deps),
    recommendations: new RecommendationService(deps, posts, match),
    regions: new RegionService(deps),
    account: new AccountService(deps),
    age: new AgeService(deps),
    notifications: new NotificationService(input),
    /** Espera os pushes em andamento (testes e desligamento). */
    flushNotifications: () => notifier.flush(),
  };
}

export type Core = ReturnType<typeof createCore>;

export { AuthService } from './auth-service.ts';
export {
  CODE_TTL_MINUTES,
  MAX_CODE_ATTEMPTS,
  MAX_CODE_SENDS,
  RESEND_COOLDOWN_SECONDS,
} from './auth-service.ts';
export type {
  AuthResult,
  ConfirmSignupInput,
  LoginInput,
  SessionUser,
  SignupInput,
  SignupStarted,
} from './auth-service.ts';
export { AvailabilityService } from './availability-service.ts';
export {
  DEFAULT_TIME_ZONE,
  MAX_ACTIVE_SLOTS,
  MAX_FRIENDS_PER_QUERY,
  MAX_RANGE_DAYS,
  MAX_SLOT_HOURS,
} from './availability-service.ts';
export type {
  BestDatesInput,
  CompatibilityView,
  FriendAvailability,
  ParticipantView,
  SlotInput,
  SlotView,
} from './availability-service.ts';
export { FlashService } from './flash-service.ts';
export {
  FLASH_HOURS,
  FLASH_NOTE_MAX,
  INVITE_TTL_MINUTES,
  POSITION_STALE_SECONDS,
} from './flash-service.ts';
export type {
  AvailableFriendView,
  FlashStatusView,
  InviteDirection,
  InviteView,
  InvitesOverview,
  MatchView,
  PositionView,
} from './flash-service.ts';
export { ConversationService, MESSAGE_MAX, MESSAGES_PER_MINUTE, parseSuggestion } from './conversation-service.ts';
export type { ConversationListItem, ConversationView, GroupDetails, MessageView } from './conversation-service.ts';
export { RecommendationService } from './recommendation-service.ts';
export type { RecommendationItem, RecommendationsView } from './recommendation-service.ts';
export { DwellService } from './dwell-service.ts';
export { SuggestionService, SUGGESTION_RADIUS_M, SUGGESTION_MAX_APART_M } from './suggestion-service.ts';
export type { SuggestionItem, SuggestionsView } from './suggestion-service.ts';
export { EventPageService } from './event-page-service.ts';
export { EventReminderService } from './event-reminder-service.ts';
export type { EventPageView, EventPostView, EventCoverView } from './event-page-service.ts';
export { BoostService, BOOST_DAY_OPTIONS, BOOST_DEFAULT_PRICE_PER_DAY_CENTS, BOOST_DEFAULT_PACKAGE_PRICES_CENTS, boostPhase, boostProductId } from './boost-service.ts';
export type { BoostPricing, BoostView, BoostPhase } from './boost-service.ts';
export { ExploreService, EXPLORE_DEFAULT_RADIUS_KM, EXPLORE_MAX_RADIUS_KM } from './explore-service.ts';
export type { ExploreEventItem, ExplorePlaceItem, ExploreView } from './explore-service.ts';
export { MeetupService, MEETUP_MAX_GUESTS } from './meetup-service.ts';
export type { MeetupView } from './meetup-view.ts';
export { distanceMeters, midpoint, boundingBox } from './geo.ts';
export { NotificationService, StoredNotifier } from './notification-service.ts';
export type { NotificationView } from './notification-service.ts';
export { ProfileEventService } from './profile-event-service.ts';
export { PostService, POST_IMAGES_MAX, POST_CAPTION_MAX } from './post-service.ts';
export type { PostedEventsPage, PostedEventView } from './profile-event-service.ts';
export type { EventCardView } from './event-card.ts';
export { BlockService } from './block-service.ts';
export { FollowService } from './follow-service.ts';
export type { ConnectionsPage, FollowResult } from './follow-service.ts';
export { ProfileService } from './profile-service.ts';
export type { ProfilePatch, ProfileView, RelationState } from './profile-service.ts';
export { DomainError } from './errors.ts';
export type { ErrorCode } from './errors.ts';
export { evaluateFriendship } from './friendship.ts';
export { HmacOneTimeCodes, Hs256TokenService, ScryptPasswordHasher } from './adapters/crypto.ts';
export type {
  AvailabilityRepository,
  BlockRepository,
  Clock,
  CoreDeps,
  EmailSender,
  ConversationRepository,
  FlashRepository,
  FollowRepository,
  PlaceRepository,
  PlaceSource,
  IdGenerator,
  OneTimeCodes,
  PasswordHasher,
  PasswordResetRepository,
  PendingSignupRepository,
  TokenClaims,
  TokenService,
  UserRepository,
} from './ports.ts';
export type {
  Actor,
  AvailabilitySlotRecord,
  FlashInviteRecord,
  FlashInviteStatus,
  FlashPositionRecord,
  FlashSessionRecord,
  ConversationRecord,
  ConversationSummaryRecord,
  ExternalPlace,
  MessageRecord,
  PlaceEventRecord,
  SuggestionCard,
  VenueRecord,
  SlotState,
  Direction,
  Follow,
  FollowStatus,
  Page,
  PendingSignup,
  Profile,
  PublicProfile,
  User,
  UserRole,
  UserStatus,
} from './types.ts';
