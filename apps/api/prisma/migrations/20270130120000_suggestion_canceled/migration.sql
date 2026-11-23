-- Quem sugeriu um local pode cancelar a sugestão; o cartão fica como "Sugestão cancelada".
ALTER TYPE "SuggestionResponse" ADD VALUE IF NOT EXISTS 'CANCELED';
