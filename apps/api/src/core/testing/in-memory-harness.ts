import type { UserStatus } from '../types.ts';
import type { RepoHarness } from './contracts.ts';
import {
  InMemoryAvailabilityRepository,
  InMemoryConversationRepository,
  InMemoryPlaceRepository,
  InMemoryVenueClaimRepository,
  InMemoryCalendarRepository,
  InMemoryAdminRepository,
  InMemoryMeetupRepository,
  InMemorySchedulingRepository,
  InMemoryNotificationRepository,
  InMemoryProfileEventRepository,
  InMemoryPostRepository,
  InMemoryEventRoomRepository,
  InMemoryAlbumRepository,
  InMemoryVenueStoryRepository,
  InMemoryFeedRepository,
  InMemoryGuestListRepository,
  InMemoryEventShoppingRepository,
  InMemoryPushSubscriptionRepository,
  InMemoryFlashRepository,
  InMemoryBlockRepository,
  InMemoryFollowRepository,
  InMemoryPasswordResetRepository,
  InMemoryAppSettingsRepository,
  InMemoryBoostRepository,
  InMemoryOfferRepository,
  InMemoryDwellRepository,
  InMemoryBoostStatsRepository,
  InMemoryRegionRepository,
  InMemoryPendingSignupRepository,
  InMemoryUserRepository,
  InMemoryReferralRepository,
} from './in-memory.ts';

export async function makeInMemoryHarness(): Promise<RepoHarness> {
  let users = new InMemoryUserRepository();
  let referrals = new InMemoryReferralRepository(users);
  let blocks = new InMemoryBlockRepository();
  let follows = new InMemoryFollowRepository(blocks);
  let pending = new InMemoryPendingSignupRepository();
  let passwordResets = new InMemoryPasswordResetRepository();
  let boosts = new InMemoryBoostRepository();
  let boostStats = new InMemoryBoostStatsRepository();
  let offers = new InMemoryOfferRepository();
  let settings = new InMemoryAppSettingsRepository();
  let dwell = new InMemoryDwellRepository();
  let regions = new InMemoryRegionRepository();
  let availability = new InMemoryAvailabilityRepository();
  let flash = new InMemoryFlashRepository();
  let conversations = new InMemoryConversationRepository();
  let places = new InMemoryPlaceRepository();
  let claims = new InMemoryVenueClaimRepository();
  let calendars = new InMemoryCalendarRepository();
  let meetups = new InMemoryMeetupRepository();
  let scheduling = new InMemorySchedulingRepository();
  let profileEvents = new InMemoryProfileEventRepository();
  let posts = new InMemoryPostRepository();
  let eventRoom = new InMemoryEventRoomRepository(posts);
  let albums = new InMemoryAlbumRepository();
  let venueStories = new InMemoryVenueStoryRepository();
  let feed = new InMemoryFeedRepository(posts, places);
  let guestLists = new InMemoryGuestListRepository(places);
  let eventShopping = new InMemoryEventShoppingRepository(posts);
  let admin = new InMemoryAdminRepository({ users, posts, conversations, places, claims, eventRoom });
  let notifications = new InMemoryNotificationRepository();
  let pushSubscriptions = new InMemoryPushSubscriptionRepository();

  // Os repositórios são trocados no reset; o proxy abaixo sempre aponta para os atuais.
  return {
    get users() {
      return users;
    },
    get referrals() {
      return referrals;
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
    get passwordResets() {
      return passwordResets;
    },
    get boosts() {
      return boosts;
    },
    get boostStats() {
      return boostStats;
    },
    get offers() {
      return offers;
    },
    get settings() {
      return settings;
    },
    get dwell() {
      return dwell;
    },
    get regions() {
      return regions;
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
    get claims() {
      return claims;
    },
    get calendars() {
      return calendars;
    },
    get admin() {
      return admin;
    },
    get meetups() {
      return meetups;
    },
    get scheduling() {
      return scheduling;
    },
    get profileEvents() {
      return profileEvents;
    },
    get posts() {
      return posts;
    },
    get albums() {
      return albums;
    },
    get venueStories() {
      return venueStories;
    },
    get eventRoom() {
      return eventRoom;
    },
    get feed() {
      return feed;
    },
    get guestLists() {
      return guestLists;
    },
    get eventShopping() {
      return eventShopping;
    },
    get notifications() {
      return notifications;
    },
    get pushSubscriptions() {
      return pushSubscriptions;
    },
    async setUserStatus(userId: string, status: UserStatus) {
      const user = users.users.get(userId);
      if (user) user.status = status;
    },
    async reset() {
      users = new InMemoryUserRepository();
      referrals = new InMemoryReferralRepository(users);
      blocks = new InMemoryBlockRepository();
      follows = new InMemoryFollowRepository(blocks);
      pending = new InMemoryPendingSignupRepository();
      passwordResets = new InMemoryPasswordResetRepository();
      boosts = new InMemoryBoostRepository();
      boostStats = new InMemoryBoostStatsRepository();
      offers = new InMemoryOfferRepository();
      settings = new InMemoryAppSettingsRepository();
      dwell = new InMemoryDwellRepository();
      regions = new InMemoryRegionRepository();
      availability = new InMemoryAvailabilityRepository();
      flash = new InMemoryFlashRepository();
      conversations = new InMemoryConversationRepository();
      places = new InMemoryPlaceRepository();
      claims = new InMemoryVenueClaimRepository();
      calendars = new InMemoryCalendarRepository();
      meetups = new InMemoryMeetupRepository();
      scheduling = new InMemorySchedulingRepository();
      profileEvents = new InMemoryProfileEventRepository();
      posts = new InMemoryPostRepository();
      eventRoom = new InMemoryEventRoomRepository(posts);
      albums = new InMemoryAlbumRepository();
      venueStories = new InMemoryVenueStoryRepository();
      feed = new InMemoryFeedRepository(posts, places);
      guestLists = new InMemoryGuestListRepository(places);
      eventShopping = new InMemoryEventShoppingRepository(posts);
      admin = new InMemoryAdminRepository({ users, posts, conversations, places, claims, eventRoom });
      notifications = new InMemoryNotificationRepository();
      pushSubscriptions = new InMemoryPushSubscriptionRepository();
    },
    async close() {},
  };
}
