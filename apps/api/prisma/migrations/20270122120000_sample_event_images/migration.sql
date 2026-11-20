-- Fotos nos eventos de EXEMPLO (histórico e próximos), escolhidas pelo tipo do evento, de um conjunto fixo de fotos do
-- Unsplash (licença livre). Só mexe em evento de exemplo ainda sem imagem: rodar de novo não troca nada.
-- O script apps/api/scripts/seed-history-places.ts usa as mesmas fotos nos eventos que ele cria.
WITH photos(kind, ids) AS (
  VALUES
    ('SHOW',       ARRAY['1501386761578-eac5c94b800a','1470229722913-7c0e2dbbafd3','1493225457124-a3eb161ffa5f','1514525253161-7a46d19cd819','1459749411175-04bf5292ceea','1511192336575-5a79af67a629']),
    ('NIGHT',      ARRAY['1516450360452-9312f5e86fc7','1566737236500-c8ac43014a67','1574391884720-bbc3740c59d1']),
    ('GASTRONOMY', ARRAY['1504674900247-0877df9cc836','1414235077428-338989a2e8c0','1555396273-367ea4eb4db5','1568901346375-23c9450c58cd','1513104890138-7c749659a591','1510812431401-41d2bd2722f3']),
    ('SPORT',      ARRAY['1574629810360-7efbbe195018','1461896836934-ffe607ba8211','1517649763962-0c623066013b']),
    ('THEATER',    ARRAY['1503095396549-807759245b35','1507676184212-d03ab07a01bf','1585699324551-f6c309eedeca']),
    ('CINEMA',     ARRAY['1489599849927-2ee91cede3ba','1536440136628-849c177e76a1']),
    ('EXHIBITION', ARRAY['1544967082-d9d25d867d66','1518998053901-5348d3961a04']),
    ('OUTDOOR',    ARRAY['1441974231531-c6227db76b6e','1504280390367-361c6d9f38f4','1511632765486-a01980e01a18']),
    ('DIGITAL',    ARRAY['1529156069898-49953e39b3ac','1511632765486-a01980e01a18']),
    ('OTHER',      ARRAY['1529156069898-49953e39b3ac','1511632765486-a01980e01a18'])
)
UPDATE "PlaceEvent" e
SET "imageUrl" = 'https://images.unsplash.com/photo-' || p.ids[1 + abs(hashtext('askout-foto:' || e.id::text)) % array_length(p.ids, 1)] || '?w=1080&q=70&auto=format&fit=crop'
FROM photos p
WHERE p.kind = e.kind::text
  AND e."isSample"
  AND e."imageUrl" IS NULL
  AND e.description IN ('Evento de exemplo do histórico do AskouT.', 'Evento de exemplo do AskouT.');
