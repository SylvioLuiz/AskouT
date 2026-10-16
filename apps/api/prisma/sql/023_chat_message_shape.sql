-- Aplicar depois da migration chat_features. Pode ser rodado de novo sem erro.
-- Foto e vídeo (IMAGE, VIDEO) não levam sugestão, encontro, evento nem duração de áudio.
ALTER TABLE "Message" DROP CONSTRAINT IF EXISTS message_suggestion_shape;
ALTER TABLE "Message" ADD CONSTRAINT message_suggestion_shape CHECK (
  (kind = 'SUGGESTION' AND suggestion IS NOT NULL AND "meetupId" IS NULL AND "eventId" IS NULL AND "postEventId" IS NULL AND "audioMs" IS NULL)
  OR (kind IN ('TEXT', 'SYSTEM', 'IMAGE', 'VIDEO') AND suggestion IS NULL AND "meetupId" IS NULL AND "eventId" IS NULL AND "postEventId" IS NULL AND "audioMs" IS NULL)
  OR (kind = 'MEETUP' AND suggestion IS NULL AND "meetupId" IS NOT NULL AND "eventId" IS NULL AND "postEventId" IS NULL AND "audioMs" IS NULL)
  OR (kind = 'EVENT' AND suggestion IS NULL AND "meetupId" IS NULL AND (("eventId" IS NOT NULL AND "postEventId" IS NULL) OR ("eventId" IS NULL AND "postEventId" IS NOT NULL)) AND "audioMs" IS NULL)
  OR (kind = 'AUDIO' AND suggestion IS NULL AND "meetupId" IS NULL AND "eventId" IS NULL AND "postEventId" IS NULL AND "audioMs" BETWEEN 1000 AND 90000)
);
-- Só reações da lista do app (a lista pode crescer; a validação fica no servidor).
ALTER TABLE "MessageReaction" DROP CONSTRAINT IF EXISTS message_reaction_emoji_len;
ALTER TABLE "MessageReaction" ADD CONSTRAINT message_reaction_emoji_len CHECK (char_length(emoji) BETWEEN 1 AND 16);
