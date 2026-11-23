-- Convites de evento criado por pessoa: quem foi convidado e por quem.
CREATE TABLE "EventInvite" (
    "postId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "invitedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventInvite_pkey" PRIMARY KEY ("postId","userId")
);

CREATE INDEX "EventInvite_userId_idx" ON "EventInvite"("userId");

ALTER TABLE "EventInvite" ADD CONSTRAINT "EventInvite_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventInvite" ADD CONSTRAINT "EventInvite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventInvite" ADD CONSTRAINT "EventInvite_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Quem já estava marcado num evento conta como convidado pelo dono.
INSERT INTO "EventInvite" ("postId", "userId", "invitedById", "createdAt")
SELECT t."postId", t."userId", p."authorId", t."createdAt"
FROM "PostTag" t JOIN "Post" p ON p."id" = t."postId"
WHERE p."eventTitle" IS NOT NULL
ON CONFLICT DO NOTHING;
