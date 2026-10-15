import type { PrismaClient } from '@prisma/client';
import type { SchedulingRepository } from '../../core/ports.ts';
import type { PollConfirmationRecord, PollParticipantRecord, PollProposalRecord, PollProposalStatus, PollRecord, PollStatus, PollVoteRecord } from '../../core/types.ts';
import { conflict } from '../../core/errors.ts';
import { isUuid } from './helpers.ts';

type PollRow = {
  id: string;
  conversationId: string;
  organizerId: string;
  title: string;
  rangeStart: string;
  rangeEnd: string;
  durationMinutes: number;
  preferredTimeStart: string | null;
  timezone: string;
  votingDeadline: Date | null;
  confirmationPolicy: string;
  greenMin: number;
  orangeMin: number;
  minCoverage: number;
  status: string;
  finalProposalId: string | null;
  meetupId: string | null;
  createdAt: Date;
};

type ProposalRow = {
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
  status: string;
  createdAt: Date;
};

function toPoll(r: PollRow): PollRecord {
  return {
    id: r.id,
    conversationId: r.conversationId,
    organizerId: r.organizerId,
    title: r.title,
    schedulingMode: 'BEST_DATE',
    rangeStart: r.rangeStart,
    rangeEnd: r.rangeEnd,
    durationMinutes: r.durationMinutes,
    preferredTimeStart: r.preferredTimeStart,
    timezone: r.timezone,
    votingDeadline: r.votingDeadline,
    confirmationPolicy: r.confirmationPolicy as PollRecord['confirmationPolicy'],
    greenMin: r.greenMin,
    orangeMin: r.orangeMin,
    minCoverage: r.minCoverage,
    status: r.status as PollStatus,
    finalProposalId: r.finalProposalId,
    meetupId: r.meetupId,
    createdAt: r.createdAt,
  };
}

function toProposal(r: ProposalRow): PollProposalRecord {
  return {
    id: r.id,
    pollId: r.pollId,
    candidateDate: r.candidateDate,
    candidateStartAt: r.candidateStartAt,
    candidateEndAt: r.candidateEndAt,
    compatibilityScore: r.compatibilityScore,
    coverageScore: r.coverageScore,
    availableCount: r.availableCount,
    maybeCount: r.maybeCount,
    unavailableCount: r.unavailableCount,
    unansweredCount: r.unansweredCount,
    status: r.status as PollProposalStatus,
    createdAt: r.createdAt,
  };
}

export class PrismaSchedulingRepository implements SchedulingRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async create(poll: PollRecord, participantIds: string[], at: Date): Promise<void> {
    void at;
    await this.prisma.datePoll.create({
      data: {
        id: poll.id,
        conversationId: poll.conversationId,
        organizerId: poll.organizerId,
        title: poll.title,
        schedulingMode: poll.schedulingMode,
        rangeStart: poll.rangeStart,
        rangeEnd: poll.rangeEnd,
        durationMinutes: poll.durationMinutes,
        preferredTimeStart: poll.preferredTimeStart,
        timezone: poll.timezone,
        votingDeadline: poll.votingDeadline,
        confirmationPolicy: poll.confirmationPolicy,
        greenMin: poll.greenMin,
        orangeMin: poll.orangeMin,
        minCoverage: poll.minCoverage,
        status: poll.status,
        finalProposalId: poll.finalProposalId,
        meetupId: poll.meetupId,
        createdAt: poll.createdAt,
        participants: { create: participantIds.map((userId) => ({ userId })) },
      },
    });
  }

  async find(id: string): Promise<PollRecord | undefined> {
    if (!isUuid(id)) return undefined;
    const row = await this.prisma.datePoll.findUnique({ where: { id } });
    return row ? toPoll(row) : undefined;
  }

  async listForConversation(conversationId: string): Promise<PollRecord[]> {
    if (!isUuid(conversationId)) return [];
    const rows = await this.prisma.datePoll.findMany({ where: { conversationId }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 100 });
    return rows.map(toPoll);
  }

  async listOpenForUser(userId: string, limit: number): Promise<PollRecord[]> {
    if (!isUuid(userId)) return [];
    const rows = await this.prisma.datePoll.findMany({
      where: { status: { in: ['VOTING', 'CONFIRMING'] }, participants: { some: { userId } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: limit,
    });
    return rows.map(toPoll);
  }

  async listParticipants(pollId: string): Promise<PollParticipantRecord[]> {
    if (!isUuid(pollId)) return [];
    const rows = await this.prisma.datePollParticipant.findMany({ where: { pollId }, orderBy: { userId: 'asc' } });
    return rows.map((r) => ({ userId: r.userId, finishedAt: r.finishedAt }));
  }

  async listVotes(pollId: string): Promise<PollVoteRecord[]> {
    if (!isUuid(pollId)) return [];
    const rows = await this.prisma.datePollVote.findMany({ where: { pollId }, orderBy: [{ candidateDate: 'asc' }, { userId: 'asc' }] });
    return rows.map((r) => ({ userId: r.userId, date: r.candidateDate, status: r.status as PollVoteRecord['status'] }));
  }

  async setVotes(pollId: string, userId: string, dates: string[], status: 'YES' | 'MAYBE' | 'NO' | null, at: Date): Promise<void> {
    if (!isUuid(pollId) || !isUuid(userId) || dates.length === 0) return;
    if (status === null) {
      await this.prisma.datePollVote.deleteMany({ where: { pollId, userId, candidateDate: { in: dates } } });
      return;
    }
    await this.prisma.$transaction(
      dates.map((candidateDate) =>
        this.prisma.datePollVote.upsert({
          where: { pollId_userId_candidateDate: { pollId, userId, candidateDate } },
          create: { pollId, userId, candidateDate, status, updatedAt: at },
          update: { status, updatedAt: at },
        }),
      ),
    );
  }

  async setFinished(pollId: string, userId: string, at: Date | null): Promise<void> {
    if (!isUuid(pollId) || !isUuid(userId)) return;
    await this.prisma.datePollParticipant.updateMany({ where: { pollId, userId }, data: { finishedAt: at } });
  }

  async updatePoll(pollId: string, patch: { status?: PollStatus; finalProposalId?: string | null; meetupId?: string | null }): Promise<void> {
    if (!isUuid(pollId)) return;
    await this.prisma.datePoll.updateMany({ where: { id: pollId }, data: patch });
  }

  async createProposal(p: PollProposalRecord): Promise<void> {
    try {
      await this.prisma.datePollProposal.create({
        data: {
          id: p.id,
          pollId: p.pollId,
          candidateDate: p.candidateDate,
          candidateStartAt: p.candidateStartAt,
          candidateEndAt: p.candidateEndAt,
          compatibilityScore: p.compatibilityScore,
          coverageScore: p.coverageScore,
          availableCount: p.availableCount,
          maybeCount: p.maybeCount,
          unavailableCount: p.unavailableCount,
          unansweredCount: p.unansweredCount,
          status: p.status,
          createdAt: p.createdAt,
        },
      });
    } catch (error) {
      // Índice único parcial: no máximo uma proposta aberta por votação.
      if ((error as { code?: string }).code === 'P2002') throw conflict('Já existe uma proposta aberta');
      throw error;
    }
  }

  async findProposal(id: string): Promise<PollProposalRecord | undefined> {
    if (!isUuid(id)) return undefined;
    const row = await this.prisma.datePollProposal.findUnique({ where: { id } });
    return row ? toProposal(row) : undefined;
  }

  async listProposals(pollId: string): Promise<PollProposalRecord[]> {
    if (!isUuid(pollId)) return [];
    const rows = await this.prisma.datePollProposal.findMany({ where: { pollId }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] });
    return rows.map(toProposal);
  }

  async updateProposal(id: string, patch: { status: PollProposalStatus }): Promise<void> {
    if (!isUuid(id)) return;
    await this.prisma.datePollProposal.updateMany({ where: { id }, data: patch });
  }

  async setConfirmation(proposalId: string, pollId: string, userId: string, status: 'CONFIRMED' | 'ADJUST' | 'DECLINED', at: Date): Promise<void> {
    if (!isUuid(proposalId) || !isUuid(pollId) || !isUuid(userId)) return;
    await this.prisma.datePollConfirmation.upsert({
      where: { proposalId_userId: { proposalId, userId } },
      create: { proposalId, pollId, userId, status, respondedAt: at },
      update: { status, respondedAt: at },
    });
  }

  async listConfirmations(proposalId: string): Promise<PollConfirmationRecord[]> {
    if (!isUuid(proposalId)) return [];
    const rows = await this.prisma.datePollConfirmation.findMany({ where: { proposalId }, orderBy: { userId: 'asc' } });
    return rows.map((r) => ({ userId: r.userId, status: r.status as PollConfirmationRecord['status'], respondedAt: r.respondedAt }));
  }
}
