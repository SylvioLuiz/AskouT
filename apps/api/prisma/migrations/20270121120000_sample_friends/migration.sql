-- Amizades de EXEMPLO entre as pessoas de exemplo do histórico (20270120120000_sample_event_history) e com três contas
-- que pediram: ariany_f, xulia e sylviofox. Amizade = as duas seguem uma à outra (ACCEPTED).
--
-- Cada conta fica amiga de 4 pessoas de exemplo. Como as pessoas de exemplo são amigas entre si, as outras aparecem em
-- "Pessoas que você talvez conheça" (amigos dos seus amigos). Nenhum aviso é mandado: as linhas entram direto.
-- Conta que não existir neste banco é ignorada. Pode rodar de novo sem duplicar (ON CONFLICT DO NOTHING).
--
-- Para desfazer (só tira as amizades com pessoas de exemplo):
--   DELETE FROM "Follow" WHERE "followerId" IN (SELECT id FROM "User" WHERE email LIKE 'hist-%@teste.askout.invalid')
--                           OR "followeeId" IN (SELECT id FROM "User" WHERE email LIKE 'hist-%@teste.askout.invalid');

WITH people(i, slug) AS (
  VALUES (0,'helena'),(1,'rafael'),(2,'lucia'),(3,'mateus'),(4,'isabela'),(5,'thiago'),(6,'marina'),(7,'gustavo'),
         (8,'beatriz'),(9,'pedro'),(10,'julia'),(11,'felipe'),(12,'camila'),(13,'leonardo'),(14,'sofia'),(15,'vinicius')
),
demo AS (
  SELECT p.i, u.id, u."createdAt"
  FROM people p JOIN "User" u ON u.email = 'hist-' || p.slug || '@teste.askout.invalid'
),
-- Cada pessoa de exemplo fica amiga de 6 outras: as vizinhas a 1, 2 e 5 posições (nos dois sentidos).
demo_pairs AS (
  SELECT a.id AS a, b.id AS b, greatest(a."createdAt", b."createdAt") + interval '3 days' AS at
  FROM demo a JOIN demo b ON b.i IN ((a.i + 1) % 16, (a.i + 2) % 16, (a.i + 5) % 16)
),
real_pairs AS (
  SELECT r."userId" AS a, d.id AS b, now() AS at
  FROM (VALUES ('ariany_f', 0), ('xulia', 4), ('sylviofox', 8)) AS t(username, first)
  JOIN "Profile" r ON r.username = t.username
  JOIN demo d ON d.i BETWEEN t.first AND t.first + 3
),
pairs AS (
  SELECT a, b, at FROM demo_pairs
  UNION ALL SELECT a, b, at FROM real_pairs
)
INSERT INTO "Follow" ("followerId", "followeeId", status, "createdAt")
SELECT a, b, 'ACCEPTED'::"FollowStatus", at FROM pairs
UNION ALL
SELECT b, a, 'ACCEPTED'::"FollowStatus", at FROM pairs
ON CONFLICT DO NOTHING;
