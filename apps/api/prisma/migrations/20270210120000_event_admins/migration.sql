-- Admins de evento criado por pessoa: o dono promove e tira; o dono continua dono.
CREATE TABLE "EventAdmin" (
    "postId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "addedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventAdmin_pkey" PRIMARY KEY ("postId","userId")
);

CREATE INDEX "EventAdmin_userId_idx" ON "EventAdmin"("userId");

ALTER TABLE "EventAdmin" ADD CONSTRAINT "EventAdmin_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventAdmin" ADD CONSTRAINT "EventAdmin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
