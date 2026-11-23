-- Local real pedido pela equipe: WHATS BAR (Santos/SP), bar com porções, drinks e karaokê. Instagram @whatsbar_.
-- Endereço e coordenadas do Google Maps; horário da bio do Instagram (seg. a sáb., 16:00 às 03:00; domingo fechado).
-- Sem dono: o dono pode reivindicar pelo app. Não é dado de exemplo (isSample = false).
-- Pode rodar de novo sem duplicar: id fixo, e não insere se já houver um local com esse nome em Santos.
INSERT INTO "Venue" (id, name, address, category, lat, lng, "isSample", description, "hoursJson", "createdAt", "updatedAt")
SELECT
  md5('askout-venue:whats-bar-santos')::uuid,
  'WHATS BAR',
  'Av. Senador Feijó, 645 - Vila Mathias, Santos - SP, 11015-505',
  'bar',
  -23.9510576,
  -46.3271297,
  false,
  'Porções, drinks e karaokê. Siga também @whats_praia.',
  '[null,{"open":"16:00","close":"03:00"},{"open":"16:00","close":"03:00"},{"open":"16:00","close":"03:00"},{"open":"16:00","close":"03:00"},{"open":"16:00","close":"03:00"},{"open":"16:00","close":"03:00"}]',
  now(),
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM "Venue"
  WHERE regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = 'whatsbar'
    AND lat BETWEEN -24.10 AND -23.85 AND lng BETWEEN -46.45 AND -46.25
)
ON CONFLICT (id) DO NOTHING;
