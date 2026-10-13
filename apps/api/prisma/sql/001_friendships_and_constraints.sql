-- Aplicar após a migration inicial do Prisma.

-- Ninguém segue a si mesmo.
ALTER TABLE "Follow" ADD CONSTRAINT follow_no_self CHECK ("followerId" <> "followeeId");
ALTER TABLE "Block"  ADD CONSTRAINT block_no_self  CHECK ("blockerId"  <> "blockedId");

-- Encontro e Flash com datas coerentes.
ALTER TABLE "AvailabilitySlot"  ADD CONSTRAINT slot_range  CHECK ("endsAt" > "startsAt");
ALTER TABLE "MeetingDateOption" ADD CONSTRAINT option_range CHECK ("endsAt" > "startsAt");
ALTER TABLE "FlashSession"      ADD CONSTRAINT flash_range  CHECK ("expiresAt" > "startsAt");

-- Amizade = seguimento mútuo aceito, sem bloqueio em nenhum sentido.
-- Uma linha por par (user_a < user_b). Fonte única da regra; o backend consulta esta view.
CREATE OR REPLACE VIEW friendships AS
SELECT a."followerId" AS user_a, a."followeeId" AS user_b
FROM "Follow" a
JOIN "Follow" b
  ON b."followerId" = a."followeeId" AND b."followeeId" = a."followerId"
WHERE a.status = 'ACCEPTED'
  AND b.status = 'ACCEPTED'
  AND a."followerId" < a."followeeId"
  AND NOT EXISTS (
    SELECT 1 FROM "Block" bl
    WHERE (bl."blockerId" = a."followerId" AND bl."blockedId" = a."followeeId")
       OR (bl."blockerId" = a."followeeId" AND bl."blockedId" = a."followerId")
  );
