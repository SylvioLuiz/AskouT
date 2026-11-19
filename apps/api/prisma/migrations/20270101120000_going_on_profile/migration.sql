-- "Eu vou" pergunta se o evento aparece na aba Eventos do perfil. Presenças antigas ficam só na aba Participou (só a pessoa vê).
ALTER TABLE "EventAttendance" ADD COLUMN "onProfile" BOOLEAN NOT NULL DEFAULT false;
-- A aba Participou passou a ser sempre só da própria pessoa: a opção de deixá-la pública saiu.
ALTER TABLE "Profile" DROP COLUMN "attendedEventsPublic";
