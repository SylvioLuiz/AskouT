-- Agenda para amigos: cada pessoa escolhe mostrar os horários dela (começa desligado; a agenda continua privada até ligar).
ALTER TABLE "UserSettings" ADD COLUMN IF NOT EXISTS "shareAvailability" BOOLEAN NOT NULL DEFAULT false;
