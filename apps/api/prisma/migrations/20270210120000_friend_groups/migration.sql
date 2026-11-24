-- Grupos de amigos (turmas): entrada só por convite aceito, e eventos criados dentro do grupo.
ALTER TABLE "Group" ADD COLUMN "community" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "GroupInvite" (
    "groupId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "invitedById" UUID,
    "shareHistory" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupInvite_pkey" PRIMARY KEY ("groupId","userId")
);

CREATE INDEX "GroupInvite_userId_idx" ON "GroupInvite"("userId");

ALTER TABLE "GroupInvite" ADD CONSTRAINT "GroupInvite_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GroupInvite" ADD CONSTRAINT "GroupInvite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Evento criado dentro de um grupo de amigos (id da conversa do grupo).
ALTER TABLE "Post" ADD COLUMN "originGroupId" UUID;
CREATE INDEX "Post_originGroupId_createdAt_idx" ON "Post"("originGroupId", "createdAt");
