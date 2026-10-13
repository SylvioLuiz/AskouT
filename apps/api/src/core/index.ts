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
  };
}

export type Core = ReturnType<typeof createCore>;

export { AuthService } from './auth-service.ts';
export type { AuthResult, LoginInput, RegisterInput, SessionUser } from './auth-service.ts';
export { BlockService } from './block-service.ts';
export { FollowService } from './follow-service.ts';
export type { ConnectionsPage, FollowResult } from './follow-service.ts';
export { ProfileService } from './profile-service.ts';
export type { ProfilePatch, ProfileView, RelationState } from './profile-service.ts';
export { DomainError } from './errors.ts';
export type { ErrorCode } from './errors.ts';
export { evaluateFriendship } from './friendship.ts';
export { Hs256TokenService, ScryptPasswordHasher } from './adapters/crypto.ts';
export type {
  BlockRepository,
  Clock,
  CoreDeps,
  FollowRepository,
  IdGenerator,
  PasswordHasher,
  TokenClaims,
  TokenService,
  UserRepository,
} from './ports.ts';
export type {
  Actor,
  Direction,
  Follow,
  FollowStatus,
  Page,
  Profile,
  PublicProfile,
  User,
  UserRole,
  UserStatus,
} from './types.ts';
