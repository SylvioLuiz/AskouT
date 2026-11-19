-- Histórico de EXEMPLO: cerca de 2 anos de eventos passados nos lugares que já existem, com "quem vai" entre
-- pessoas de exemplo criadas aqui. Nenhuma conta real é usada nem aparece nesses eventos.
--
-- Como tudo é marcado:
--   * Pessoas: e-mail hist-<nome>@teste.askout.invalid (domínio que não existe), senha que nunca entra
--     (mesmo hash inválido do seed:demo), nome "[TESTE] ..." e usuário teste_<nome>.
--   * Eventos: isSample = true (o app mostra o selo "Exemplo de teste") e id derivado de
--     md5('askout-historico:event:<n>'), n de 1 a 312.
--   * Presenças: só dessas pessoas de exemplo, nesses eventos.
--
-- Pode rodar de novo sem duplicar: os ids são fixos e todo INSERT usa ON CONFLICT DO NOTHING.
-- Os eventos só vão para lugares sem dono, que não são organização nem criados por usuário: quem administra
-- um lugar não vê eventos inventados na página dele. Sem lugares assim, nada é criado.
--
-- Para apagar tudo depois (as presenças caem junto, por cascata):
--   DELETE FROM "PlaceEvent" WHERE "isSample" AND id IN (SELECT md5('askout-historico:event:' || n)::uuid FROM generate_series(1, 312) n);
--   DELETE FROM "User" WHERE email LIKE 'hist-%@teste.askout.invalid';

-- 1. Pessoas de exemplo (sem login).
WITH people(slug, name, bio, joined_days_ago) AS (
  VALUES
    ('helena',  'Helena',  'Samba no fim de semana e café na segunda.',      760),
    ('rafael',  'Rafael',  'Sempre atrás de um show pequeno.',               755),
    ('lucia',   'Lúcia',   'Teatro, exposição e um bom vinho depois.',       748),
    ('mateus',  'Mateus',  'Jogo no bar, pagode depois.',                    742),
    ('isabela', 'Isabela', 'Pista até o sol nascer.',                        735),
    ('thiago',  'Thiago',  'Trilha cedo, cinema à noite.',                   721),
    ('marina',  'Marina',  'Provando um restaurante novo por semana.',       706),
    ('gustavo', 'Gustavo', 'Rock, cerveja artesanal e amigos.',              690),
    ('beatriz', 'Beatriz', 'Galerias e feirinhas de domingo.',               664),
    ('pedro',   'Pedro',   'Sessão de cinema é sagrada.',                    640),
    ('julia',   'Júlia',   'Se tem música ao vivo, eu vou.',                 611),
    ('felipe',  'Felipe',  'Corrida no parque e happy hour.',                575),
    ('camila',  'Camila',  'Stand-up, teatro e um drink.',                   540),
    ('leonardo','Leonardo','Balada eletrônica e boteco raiz.',               498),
    ('sofia',   'Sofia',   'Brunch, museu e pôr do sol.',                    455),
    ('vinicius','Vinícius','Roda de samba toda sexta.',                      410)
)
INSERT INTO "User" (id, email, "passwordHash", "createdAt", "updatedAt", "birthDate", "termsAcceptedAt", "termsVersion", "onboardedAt")
SELECT md5('askout-historico:user:' || slug)::uuid,
       'hist-' || slug || '@teste.askout.invalid',
       '!conta-de-exemplo-sem-login',
       now() - joined_days_ago * interval '1 day',
       now() - joined_days_ago * interval '1 day',
       DATE '1996-03-10',
       now() - joined_days_ago * interval '1 day',
       '2026-10-22',
       now() - joined_days_ago * interval '1 day'
FROM people
ON CONFLICT DO NOTHING;

INSERT INTO "Profile" ("userId", username, "displayName", bio)
SELECT u.id, 'teste_' || p.slug, '[TESTE] ' || p.name, p.bio
FROM (VALUES
    ('helena',  'Helena',  'Samba no fim de semana e café na segunda.'),
    ('rafael',  'Rafael',  'Sempre atrás de um show pequeno.'),
    ('lucia',   'Lúcia',   'Teatro, exposição e um bom vinho depois.'),
    ('mateus',  'Mateus',  'Jogo no bar, pagode depois.'),
    ('isabela', 'Isabela', 'Pista até o sol nascer.'),
    ('thiago',  'Thiago',  'Trilha cedo, cinema à noite.'),
    ('marina',  'Marina',  'Provando um restaurante novo por semana.'),
    ('gustavo', 'Gustavo', 'Rock, cerveja artesanal e amigos.'),
    ('beatriz', 'Beatriz', 'Galerias e feirinhas de domingo.'),
    ('pedro',   'Pedro',   'Sessão de cinema é sagrada.'),
    ('julia',   'Júlia',   'Se tem música ao vivo, eu vou.'),
    ('felipe',  'Felipe',  'Corrida no parque e happy hour.'),
    ('camila',  'Camila',  'Stand-up, teatro e um drink.'),
    ('leonardo','Leonardo','Balada eletrônica e boteco raiz.'),
    ('sofia',   'Sofia',   'Brunch, museu e pôr do sol.'),
    ('vinicius','Vinícius','Roda de samba toda sexta.')
  ) AS p(slug, name, bio)
JOIN "User" u ON u.id = md5('askout-historico:user:' || p.slug)::uuid
ON CONFLICT DO NOTHING;

INSERT INTO "UserSettings" ("userId")
SELECT id FROM "User" WHERE email LIKE 'hist-%@teste.askout.invalid'
ON CONFLICT DO NOTHING;

-- 2. Eventos passados: 312 (uns 3 por semana), do mais antigo (~730 dias atrás) ao mais recente (~3 dias atrás).
WITH venues AS (
  SELECT id, lower(coalesce(category, '')) AS cat, row_number() OVER (ORDER BY id) AS rn, count(*) OVER () AS total
  FROM "Venue"
  WHERE "ownerId" IS NULL AND NOT "isOrganization" AND NOT "isUserCreated"
),
slots AS (
  SELECT n,
         abs(hashtext('askout-historico:h:' || n)::bigint) AS h,
         floor(3 + (312 - n) * 727.0 / 311)::int AS days_ago
  FROM generate_series(1, 312) n
),
picked AS (
  SELECT s.n, s.h, s.days_ago, v.id AS venue_id, v.cat
  FROM slots s
  JOIN venues v ON v.rn = 1 + (s.h % v.total)
),
typed AS (
  SELECT p.*,
    (CASE
      WHEN cat ~ '(cinema|movie)' THEN 'CINEMA'
      WHEN cat ~ '(theat|teatro)' THEN (ARRAY['THEATER','THEATER','SHOW'])[1 + h % 3]
      WHEN cat ~ '(gallery|galeria|museum|museu)' THEN 'EXHIBITION'
      WHEN cat ~ '(park|parque|praia|beach)' THEN (ARRAY['OUTDOOR','OUTDOOR','SPORT'])[1 + h % 3]
      WHEN cat ~ '(stadium|gym|sport|academia|estadio)' THEN 'SPORT'
      WHEN cat ~ '(night|club|balada|boate)' THEN (ARRAY['NIGHT','NIGHT','SHOW'])[1 + h % 3]
      WHEN cat ~ '(bar|pub|boteco)' THEN (ARRAY['SHOW','NIGHT','GASTRONOMY','SPORT','SHOW'])[1 + h % 5]
      WHEN cat ~ '(restaurant|restaurante|cafe|food|bakery|padaria)' THEN (ARRAY['GASTRONOMY','GASTRONOMY','SHOW'])[1 + h % 3]
      ELSE (ARRAY['SHOW','GASTRONOMY','OTHER'])[1 + h % 3]
    END)::"EventKind" AS kind
  FROM picked p
),
shaped AS (
  SELECT t.*,
    CASE kind
      WHEN 'SHOW' THEN (ARRAY['Show acústico','Noite de MPB','Roda de samba','Pagode ao vivo','Tributo ao rock nacional','Jazz na sexta','Forró pé de serra','Voz e violão'])[1 + (h / 7) % 8]
      WHEN 'NIGHT' THEN (ARRAY['Festa anos 2000','Noite eletrônica','Baile funk','Sexta de house','Flashback','Festa open format'])[1 + (h / 7) % 6]
      WHEN 'GASTRONOMY' THEN (ARRAY['Festival de hambúrguer','Noite da pizza','Feijoada de sábado','Harmonização de vinhos','Rodízio de petiscos','Brunch de domingo','Degustação de cervejas'])[1 + (h / 7) % 7]
      WHEN 'SPORT' THEN (ARRAY['Final do campeonato no telão','Clássico no telão','Corrida de rua 5 km','Torneio de futevôlei'])[1 + (h / 7) % 4]
      WHEN 'THEATER' THEN (ARRAY['Stand-up comedy','Peça em cartaz','Improviso','Monólogo'])[1 + (h / 7) % 4]
      WHEN 'CINEMA' THEN (ARRAY['Sessão de clássicos','Maratona de terror','Pré-estreia','Mostra de curtas'])[1 + (h / 7) % 4]
      WHEN 'EXHIBITION' THEN (ARRAY['Abertura de exposição','Feira de arte','Exposição de fotografia','Visita guiada'])[1 + (h / 7) % 4]
      WHEN 'OUTDOOR' THEN (ARRAY['Piquenique no parque','Yoga ao ar livre','Feirinha de domingo','Pôr do sol com música'])[1 + (h / 7) % 4]
      ELSE (ARRAY['Encontro da comunidade','Quiz no bar','Karaokê'])[1 + (h / 7) % 3]
    END AS title,
    CASE kind
      WHEN 'SHOW' THEN ARRAY['musicaaovivo','show']
      WHEN 'NIGHT' THEN ARRAY['balada','festa']
      WHEN 'GASTRONOMY' THEN ARRAY['gastronomia','comida']
      WHEN 'SPORT' THEN ARRAY['esporte']
      WHEN 'THEATER' THEN ARRAY['teatro']
      WHEN 'CINEMA' THEN ARRAY['cinema']
      WHEN 'EXHIBITION' THEN ARRAY['arte','exposicao']
      WHEN 'OUTDOOR' THEN ARRAY['arlivre']
      ELSE ARRAY[]::text[]
    END AS tags,
    CASE kind
      WHEN 'NIGHT' THEN 23 WHEN 'SHOW' THEN 21 WHEN 'THEATER' THEN 20 WHEN 'CINEMA' THEN 19
      WHEN 'GASTRONOMY' THEN (ARRAY[12,19,20])[1 + (h / 11) % 3]
      WHEN 'EXHIBITION' THEN 14 WHEN 'OUTDOOR' THEN 9 WHEN 'SPORT' THEN 16 ELSE 19
    END AS start_hour,
    CASE kind
      WHEN 'NIGHT' THEN 5 WHEN 'SHOW' THEN 3 WHEN 'THEATER' THEN 2 WHEN 'CINEMA' THEN 3
      WHEN 'EXHIBITION' THEN 4 WHEN 'OUTDOOR' THEN 4 ELSE 3
    END AS hours
  FROM typed t
),
timed AS (
  SELECT s.*,
    -- Data e hora no fuso de São Paulo, gravadas em UTC como o resto do app.
    ((date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') - days_ago * interval '1 day' + start_hour * interval '1 hour')
      AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'UTC' AS starts_at
  FROM shaped s
)
INSERT INTO "PlaceEvent" (id, "venueId", title, description, "startsAt", "endsAt", kind, "isFree", tags, "isSample", "createdAt", "updatedAt")
SELECT md5('askout-historico:event:' || n)::uuid,
       venue_id,
       title,
       'Evento de exemplo do histórico do AskouT.',
       starts_at,
       starts_at + hours * interval '1 hour',
       kind,
       (h / 13) % 3 = 0,
       tags,
       true,
       starts_at - (7 + (h / 17) % 14) * interval '1 day',
       starts_at - (7 + (h / 17) % 14) * interval '1 day'
FROM timed
ON CONFLICT DO NOTHING;

-- 3. "Quem vai": de 3 a 12 pessoas de exemplo por evento, que já tinham conta na data do evento.
WITH events AS (
  SELECT e.id, e."startsAt", 3 + abs(hashtext('askout-historico:k:' || e.id)::bigint) % 10 AS k
  FROM "PlaceEvent" e
  WHERE e."isSample" AND e.id IN (SELECT md5('askout-historico:event:' || n)::uuid FROM generate_series(1, 312) n)
),
ranked AS (
  SELECT ev.id AS event_id, ev."startsAt", ev.k, u.id AS user_id, u."createdAt" AS joined_at,
         abs(hashtext('askout-historico:a:' || ev.id || u.id)::bigint) AS h,
         row_number() OVER (PARTITION BY ev.id ORDER BY hashtext('askout-historico:a:' || ev.id || u.id)) AS pos
  FROM events ev
  JOIN "User" u ON u.email LIKE 'hist-%@teste.askout.invalid' AND u."createdAt" < ev."startsAt" - interval '1 day'
)
INSERT INTO "EventAttendance" (id, "userId", "placeEventId", "createdAt", "onProfile")
SELECT md5('askout-historico:att:' || event_id || user_id)::uuid,
       user_id,
       event_id,
       greatest(joined_at, "startsAt" - (1 + h % 6) * interval '1 day'),
       h % 3 <> 0
FROM ranked
WHERE pos <= k
ON CONFLICT DO NOTHING;
