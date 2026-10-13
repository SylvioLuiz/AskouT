import { AvailabilityService } from './availability-service.ts';
import { AuthService } from './auth-service.ts';
import { BlockService } from './block-service.ts';
import { FlashService } from './flash-service.ts';
import { ConversationService } from './conversation-service.ts';
import { FollowService } from './follow-service.ts';
import { SuggestionService } from './suggestion-service.ts';
import type { CoreDeps } from './ports.ts';
import { ProfileService } from './profile-service.ts';

export function createCore(deps: CoreDeps) {
  const flash = new FlashService(deps);
  return {
    auth: new AuthService(deps),
    profiles: new ProfileService(deps),
    follows: new FollowService(deps),
    blocks: new BlockService(deps),
    availability: new AvailabilityService(deps),
    flash,
    conversations: new ConversationService(deps),
    suggestions: new SuggestionService(deps, flash),
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
export type { ConversationListItem, ConversationView, MessageView } from './conversation-service.ts';
export { SuggestionService, SUGGESTION_RADIUS_M, SUGGESTION_MAX_APART_M } from './suggestion-service.ts';
export type { SuggestionItem, SuggestionsView } from './suggestion-service.ts';
export { distanceMeters, midpoint, boundingBox } from './geo.ts';
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
