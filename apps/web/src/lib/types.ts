// Formatos que a API devolve (ver apps/api/src/core). Só tipos: nada aqui roda.

export type Role = 'USER' | 'VENUE_OWNER' | 'ADMIN';

export interface PublicProfile {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  isPrivate: boolean;
}

export interface Profile extends PublicProfile {
  bio: string | null;
}

export type RelationState = 'NONE' | 'PENDING' | 'ACCEPTED';

export interface Relationship {
  isSelf: boolean;
  /** O visitante segue este perfil? */
  following: RelationState;
  /** Este perfil segue o visitante? PENDING = pediu para seguir e espera aprovação. */
  followsYou: RelationState;
  isFriend: boolean;
  blockedByViewer: boolean;
}

export interface ProfileView {
  profile: Profile;
  counts: { followers: number; following: number };
  relationship: Relationship;
  canViewContent: boolean;
}

export interface SessionUser {
  id: string;
  email: string;
  role: Role;
  profile: PublicProfile;
}

export interface AuthResult {
  user: SessionUser;
  token: string;
}

export interface SignupStarted {
  email: string;
  expiresAt: string;
  resendAvailableAt: string;
}

export interface ConnectionsPage {
  items: PublicProfile[];
  total: number;
  limit: number;
  offset: number;
}

export interface PageRequest {
  limit?: number;
  offset?: number;
}

export interface SignupInput {
  email: string;
  username: string;
  displayName?: string;
  password: string;
}

export interface ProfilePatch {
  displayName?: string;
  bio?: string;
  avatarUrl?: string;
}
