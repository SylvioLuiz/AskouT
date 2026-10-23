import type { PrismaClient } from '@prisma/client';
import type { AccountRepository } from '../../core/ports.ts';
import { isUuid } from './helpers.ts';

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

/**
 * Exportação e exclusão da conta (LGPD). Mexe em muitas tabelas, por isso tudo da exclusão roda numa transação só:
 * ou apaga tudo, ou nada.
 */
export class PrismaAccountRepository implements AccountRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async hasExternalIdentity(userId: string): Promise<boolean> {
    if (!isUuid(userId)) return false;
    return (await this.prisma.externalIdentity.count({ where: { userId } })) > 0;
  }

  async activeBoostCount(userId: string, now: Date): Promise<number> {
    if (!isUuid(userId)) return 0;
    return this.prisma.boost.count({ where: { ownerId: userId, status: 'PAID', endsAt: { gt: now } } });
  }

  async exportData(userId: string): Promise<Record<string, unknown>> {
    if (!isUuid(userId)) return {};
    const p = this.prisma;
    const [user, settings, notificationSetting, region, following, followers, blocks, slots, posts, comments, likes, eventPosts, stories, attendances, messages, participations, flashSent, flashReceived, meetingsOrganized, meetingParticipations, pollVotes, venueFollows, venueRatings, claims, boosts, notifications, dwell, identities, pushCount, groups] = await Promise.all([
      p.user.findUnique({ where: { id: userId }, include: { profile: true } }),
      p.userSettings.findUnique({ where: { userId } }),
      p.notificationSetting.findUnique({ where: { userId } }),
      p.userRegion.findUnique({ where: { userId } }),
      p.follow.findMany({ where: { followerId: userId }, include: { followee: { include: { profile: true } } } }),
      p.follow.findMany({ where: { followeeId: userId }, include: { follower: { include: { profile: true } } } }),
      p.block.findMany({ where: { blockerId: userId }, include: { blocked: { include: { profile: true } } } }),
      p.availabilitySlot.findMany({ where: { userId }, orderBy: { startsAt: 'asc' } }),
      p.post.findMany({ where: { authorId: userId }, include: { tags: true, images: { select: { id: true, position: true, mime: true, placePhotoRef: false } } }, orderBy: { createdAt: 'asc' } }),
      p.postComment.findMany({ where: { authorId: userId }, orderBy: { createdAt: 'asc' } }),
      p.postLike.findMany({ where: { userId } }),
      p.eventPost.findMany({ where: { authorId: userId }, select: { id: true, eventId: true, caption: true, mime: true, createdAt: true } }),
      p.eventStory.findMany({ where: { userId }, select: { id: true, placeEventId: true, postId: true, mime: true, isVideo: true, createdAt: true, expiresAt: true } }),
      p.eventAttendance.findMany({ where: { userId } }),
      p.message.findMany({ where: { senderId: userId }, select: { id: true, conversationId: true, kind: true, body: true, createdAt: true, deletedAt: true }, orderBy: { createdAt: 'asc' } }),
      p.conversationParticipant.findMany({ where: { userId }, include: { conversation: { select: { id: true, type: true, createdAt: true } } } }),
      p.flashInvite.findMany({ where: { fromUserId: userId }, include: { to: { include: { profile: true } } } }),
      p.flashInvite.findMany({ where: { toUserId: userId }, include: { from: { include: { profile: true } } } }),
      p.meeting.findMany({ where: { organizerId: userId } }),
      p.meetingParticipant.findMany({ where: { userId } }),
      p.datePollVote.findMany({ where: { userId } }),
      p.venueFollow.findMany({ where: { userId } }),
      p.venueRating.findMany({ where: { userId } }),
      p.venueClaim.findMany({ where: { userId }, select: { id: true, venueId: true, status: true, note: true, createdAt: true, reviewedAt: true } }),
      p.boost.findMany({ where: { ownerId: userId } }),
      p.notification.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
      p.contentDwell.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
      p.externalIdentity.findMany({ where: { userId }, select: { provider: true, createdAt: true } }),
      p.pushSubscription.count({ where: { userId } }),
      p.groupMember.findMany({ where: { userId }, include: { group: { select: { id: true, name: true, createdAt: true } } } }),
    ]);
    const who = (u: { profile: { username: string; displayName: string } | null }) => (u.profile ? { username: u.profile.username, displayName: u.profile.displayName } : null);
    return {
      account: user ? { id: user.id, email: user.email, status: user.status, role: user.role, createdAt: iso(user.createdAt), birthDate: user.birthDate ? user.birthDate.toISOString().slice(0, 10) : null } : null,
      profile: user?.profile ? { username: user.profile.username, displayName: user.profile.displayName, bio: user.profile.bio, isPrivate: user.profile.isPrivate } : null,
      settings: { timeZone: settings?.timeZone ?? null, notifyPrefs: settings?.notifyPrefs ?? null, notifications: notificationSetting ? { muteAll: notificationSetting.muteAll, muteChats: notificationSetting.muteChats, muteEvents: notificationSetting.muteEvents } : null },
      region: region ? { lat: region.lat, lng: region.lng, updatedAt: iso(region.updatedAt) } : null,
      loginProviders: identities.map((i) => ({ provider: i.provider, linkedAt: iso(i.createdAt) })),
      pushDevices: pushCount,
      following: following.map((f) => ({ ...who(f.followee), status: f.status, since: iso(f.createdAt) })),
      followers: followers.map((f) => ({ ...who(f.follower), status: f.status, since: iso(f.createdAt) })),
      blocked: blocks.map((b) => ({ ...who(b.blocked), since: iso(b.createdAt) })),
      availability: slots.map((s) => ({ startsAt: iso(s.startsAt), endsAt: iso(s.endsAt), state: s.state, recurrenceRule: s.recurrenceRule, createdAt: iso(s.createdAt) })),
      posts: posts.map((x) => ({ id: x.id, caption: x.caption, place: x.placeName, event: x.eventTitle, eventStartsAt: iso(x.eventStartsAt), photos: x.images.length, tags: x.tags.length, archivedAt: iso(x.archivedAt), createdAt: iso(x.createdAt) })),
      comments: comments.map((c) => ({ postId: c.postId, body: c.body, createdAt: iso(c.createdAt) })),
      likes: likes.map((l) => ({ postId: l.postId, createdAt: iso(l.createdAt) })),
      eventPosts: eventPosts.map((e) => ({ id: e.id, eventId: e.eventId, caption: e.caption, hasImage: e.mime !== null, createdAt: iso(e.createdAt) })),
      eventStories: stories.map((s) => ({ id: s.id, eventId: s.placeEventId, postId: s.postId, isVideo: s.isVideo, createdAt: iso(s.createdAt), expiresAt: iso(s.expiresAt) })),
      eventAttendances: attendances.map((a) => ({ eventId: a.placeEventId, postId: a.postId, createdAt: iso(a.createdAt) })),
      messagesSent: messages.map((m) => ({ id: m.id, conversationId: m.conversationId, kind: m.kind, body: m.deletedAt ? null : m.body, deleted: m.deletedAt !== null, createdAt: iso(m.createdAt) })),
      conversations: participations.map((c) => ({ id: c.conversation.id, type: c.conversation.type, muted: c.muted, createdAt: iso(c.conversation.createdAt) })),
      groups: groups.map((g) => ({ id: g.group.id, name: g.group.name, role: g.role, joinedAt: iso(g.joinedAt) })),
      flashInvitesSent: flashSent.map((f) => ({ to: who(f.to), status: f.status, createdAt: iso(f.createdAt) })),
      flashInvitesReceived: flashReceived.map((f) => ({ from: who(f.from), status: f.status, createdAt: iso(f.createdAt) })),
      meetingsOrganized: meetingsOrganized.map((m) => ({ id: m.id, title: m.title, status: m.status, startsAt: iso(m.startsAt), createdAt: iso(m.createdAt) })),
      meetingParticipations: meetingParticipations.map((m) => ({ meetingId: m.meetingId, status: m.status, respondedAt: iso(m.respondedAt) })),
      datePollVotes: pollVotes.map((v) => ({ pollId: v.pollId, candidateDate: v.candidateDate, status: v.status, updatedAt: iso(v.updatedAt) })),
      venuesFollowed: venueFollows.map((v) => ({ venueId: v.venueId, since: iso(v.createdAt) })),
      venueRatings: venueRatings.map((v) => ({ venueId: v.venueId, stars: v.stars, updatedAt: iso(v.updatedAt) })),
      venueClaims: claims.map((c) => ({ id: c.id, venueId: c.venueId, status: c.status, note: c.note, createdAt: iso(c.createdAt), reviewedAt: iso(c.reviewedAt) })),
      boosts: boosts.map((b) => ({ id: b.id, venueId: b.venueId, target: b.target, days: b.days, amountCents: b.amountCents, status: b.status, createdAt: iso(b.createdAt), paidAt: iso(b.paidAt), startsAt: iso(b.startsAt), endsAt: iso(b.endsAt) })),
      notifications: notifications.map((n) => ({ type: n.type, readAt: iso(n.readAt), createdAt: iso(n.createdAt) })),
      usageForRecommendations: dwell.map((d) => ({ targetType: d.targetType, targetId: d.targetId, ms: d.ms, source: d.source, clicked: d.clicked, shared: d.shared, createdAt: iso(d.createdAt) })),
    };
  }

  async deleteAccount(userId: string): Promise<void> {
    if (!isUuid(userId)) return;
    await this.prisma.$transaction(
      async (tx) => {
        const user = await tx.user.findUnique({ where: { id: userId }, select: { email: true } });
        if (!user) return;

        // Grupos de que a pessoa é dona: passam para o membro mais antigo; sem outros membros, o grupo some.
        const owned = await tx.group.findMany({ where: { ownerId: userId }, include: { members: { orderBy: { joinedAt: 'asc' } } } });
        for (const group of owned) {
          const next = group.members.find((m) => m.userId !== userId);
          if (next) {
            await tx.group.update({ where: { id: group.id }, data: { ownerId: next.userId } });
            await tx.groupMember.update({ where: { groupId_userId: { groupId: group.id, userId: next.userId } }, data: { role: 'OWNER' } });
          } else {
            await tx.group.delete({ where: { id: group.id } });
          }
        }

        // Estes três não apagam em cascata (a chave estrangeira recusa), então saem primeiro.
        await tx.meeting.deleteMany({ where: { organizerId: userId } });
        await tx.message.deleteMany({ where: { senderId: userId } });

        await tx.pendingSignup.deleteMany({ where: { email: user.email } });
        // O resto (perfil, posts, seguidores, bloqueios, agenda, Flash, avisos, região, uso...) vai em cascata.
        await tx.user.delete({ where: { id: userId } });

        // Conversa que ficou sem ninguém não serve para nada.
        await tx.conversation.deleteMany({ where: { participants: { none: {} } } });
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
  }
}
