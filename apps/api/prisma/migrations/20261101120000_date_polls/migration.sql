-- "Encontrar a melhor data": votação de disponibilidade, propostas e confirmações.
CREATE TABLE "DatePoll" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "organizerId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "schedulingMode" TEXT NOT NULL DEFAULT 'BEST_DATE',
    "rangeStart" VARCHAR(10) NOT NULL,
    "rangeEnd" VARCHAR(10) NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "preferredTimeStart" VARCHAR(5),
    "timezone" TEXT NOT NULL,
    "votingDeadline" TIMESTAMP(3),
    "confirmationPolicy" TEXT NOT NULL,
    "greenMin" INTEGER NOT NULL DEFAULT 80,
    "orangeMin" INTEGER NOT NULL DEFAULT 50,
    "minCoverage" INTEGER NOT NULL DEFAULT 50,
    "status" TEXT NOT NULL DEFAULT 'VOTING',
    "finalProposalId" UUID,
    "meetupId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DatePoll_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DatePollParticipant" (
    "pollId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "finishedAt" TIMESTAMP(3),
    CONSTRAINT "DatePollParticipant_pkey" PRIMARY KEY ("pollId","userId")
);

CREATE TABLE "DatePollVote" (
    "pollId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "candidateDate" VARCHAR(10) NOT NULL,
    "status" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DatePollVote_pkey" PRIMARY KEY ("pollId","userId","candidateDate")
);

CREATE TABLE "DatePollProposal" (
    "id" UUID NOT NULL,
    "pollId" UUID NOT NULL,
    "candidateDate" VARCHAR(10) NOT NULL,
    "candidateStartAt" TIMESTAMP(3) NOT NULL,
    "candidateEndAt" TIMESTAMP(3) NOT NULL,
    "compatibilityScore" DOUBLE PRECISION,
    "coverageScore" INTEGER NOT NULL,
    "availableCount" INTEGER NOT NULL,
    "maybeCount" INTEGER NOT NULL,
    "unavailableCount" INTEGER NOT NULL,
    "unansweredCount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DatePollProposal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DatePollConfirmation" (
    "proposalId" UUID NOT NULL,
    "pollId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "respondedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DatePollConfirmation_pkey" PRIMARY KEY ("proposalId","userId")
);

CREATE INDEX "DatePoll_conversationId_createdAt_idx" ON "DatePoll"("conversationId", "createdAt");
CREATE INDEX "DatePoll_organizerId_idx" ON "DatePoll"("organizerId");
CREATE INDEX "DatePollParticipant_userId_idx" ON "DatePollParticipant"("userId");
CREATE INDEX "DatePollVote_userId_idx" ON "DatePollVote"("userId");
CREATE INDEX "DatePollProposal_pollId_createdAt_idx" ON "DatePollProposal"("pollId", "createdAt");
CREATE INDEX "DatePollConfirmation_pollId_idx" ON "DatePollConfirmation"("pollId");

ALTER TABLE "DatePoll" ADD CONSTRAINT "DatePoll_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DatePoll" ADD CONSTRAINT "DatePoll_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DatePollParticipant" ADD CONSTRAINT "DatePollParticipant_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "DatePoll"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DatePollParticipant" ADD CONSTRAINT "DatePollParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DatePollVote" ADD CONSTRAINT "DatePollVote_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "DatePoll"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DatePollVote" ADD CONSTRAINT "DatePollVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DatePollProposal" ADD CONSTRAINT "DatePollProposal_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "DatePoll"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DatePollConfirmation" ADD CONSTRAINT "DatePollConfirmation_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "DatePollProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DatePollConfirmation" ADD CONSTRAINT "DatePollConfirmation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
