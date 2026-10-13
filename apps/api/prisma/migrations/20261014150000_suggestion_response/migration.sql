-- CreateEnum
CREATE TYPE "SuggestionResponse" AS ENUM ('ACCEPTED', 'DECLINED');

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "respondedAt" TIMESTAMP(3),
ADD COLUMN     "response" "SuggestionResponse";
