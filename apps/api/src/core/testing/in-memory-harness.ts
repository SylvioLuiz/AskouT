import type { UserStatus } from '../types.ts';
import type { RepoHarness } from './contracts.ts';
import {
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
    async setUserStatus(userId: string, status: UserStatus) {
      const user = users.users.get(userId);
      if (user) user.status = status;
    },
    async reset() {
      users = new InMemoryUserRepository();
      blocks = new InMemoryBlockRepository();
      follows = new InMemoryFollowRepository(blocks);
      pending = new InMemoryPendingSignupRepository();
    },
    async close() {},
  };
}
