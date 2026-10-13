import type { UserStatus } from '../types.ts';
import type { RepoHarness } from './contracts.ts';
import {
  InMemoryAvailabilityRepository,
  InMemoryConversationRepository,
  InMemoryPlaceRepository,
  InMemoryMeetupRepository,
  InMemoryFlashRepository,
  InMemoryBlockRepository,
  InMemoryFollowRepository,
  InMemoryPendingSignupRepository,
  InMemoryUserRepository,
} from './in-memory.ts';

export async function makeInMemoryHarness(): Promise<RepoHarness> {
  let users = new InMemoryUserRepository();
  let blocks = new InMemoryBlockRepository();
  let follows = new InMemoryFollowRepository(blocks);
  let pending = new InMemoryPendingSignupRepository();
  let availability = new InMemoryAvailabilityRepository();
  let flash = new InMemoryFlashRepository();
  let conversations = new InMemoryConversationRepository();
  let places = new InMemoryPlaceRepository();
  let meetups = new InMemoryMeetupRepository();

  // Os repositórios são trocados no reset; o proxy abaixo sempre aponta para os atuais.
  return {
    get users() {
      return users;
    },
    get follows() {
      return follows;
    },
    get blocks() {
      return blocks;
    },
    get pending() {
      return pending;
    },
    get availability() {
      return availability;
    },
    get flash() {
      return flash;
    },
    get conversations() {
      return conversations;
    },
    get places() {
      return places;
    },
    get meetups() {
      return meetups;
    },
    async setUserStatus(userId: string, status: UserStatus) {
      const user = users.users.get(userId);
      if (user) user.status = status;
    },
    async reset() {
      users = new InMemoryUserRepository();
      blocks = new InMemoryBlockRepository();
      follows = new InMemoryFollowRepository(blocks);
      pending = new InMemoryPendingSignupRepository();
      availability = new InMemoryAvailabilityRepository();
      flash = new InMemoryFlashRepository();
      conversations = new InMemoryConversationRepository();
      places = new InMemoryPlaceRepository();
      meetups = new InMemoryMeetupRepository();
    },
    async close() {},
  };
}
