-- Post que é um evento criado pela pessoa.
ALTER TABLE "Post" ADD COLUMN "eventTitle" TEXT,
ADD COLUMN "eventStartsAt" TIMESTAMP(3),
ADD COLUMN "eventEndsAt" TIMESTAMP(3);
