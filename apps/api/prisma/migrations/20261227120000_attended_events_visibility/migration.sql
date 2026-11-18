-- Aba "Participou" no perfil: a pessoa escolhe se visitantes veem os eventos que ela já foi (desligada por padrão).
ALTER TABLE "Profile" ADD COLUMN "attendedEventsPublic" BOOLEAN NOT NULL DEFAULT false;
