ALTER TABLE "DatePoll" ADD COLUMN "eventPostId" UUID;
ALTER TABLE "DatePoll" ADD CONSTRAINT "DatePoll_eventPostId_fkey" FOREIGN KEY ("eventPostId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "DatePoll_eventPostId_idx" ON "DatePoll"("eventPostId");
