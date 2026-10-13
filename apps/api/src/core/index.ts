import { AvailabilityService } from './availability-service.ts';
import { AuthService } from './auth-service.ts';
import { BlockService } from './block-service.ts';
import { FollowService } from './follow-service.ts';
import type { CoreDeps } from './ports.ts';
import { ProfileService } from './profile-service.ts';

export function createCore(deps: CoreDeps) {
  return {
    auth: new AuthService(deps),
    profiles: new ProfileService(deps),
    follows: new FollowService(deps),
    blocks: new BlockService(deps),
    availability: new AvailabilityService(deps),
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
  FollowRepository,
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
