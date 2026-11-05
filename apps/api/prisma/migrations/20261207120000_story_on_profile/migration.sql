-- Story de evento publicado também no perfil: aparece na página inicial dos amigos.
ALTER TABLE "EventStory" ADD COLUMN "onProfile" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "EventStory_userId_onProfile_expiresAt_idx" ON "EventStory"("userId", "onProfile", "expiresAt");
