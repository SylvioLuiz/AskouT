-- Comentário feito como estabelecimento.
ALTER TABLE "PostComment" ADD COLUMN "venueId" UUID;
ALTER TABLE "PostComment" ADD CONSTRAINT "PostComment_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE SET NULL ON UPDATE CASCADE;
