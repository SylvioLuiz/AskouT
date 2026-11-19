-- Gostos de rolê da pessoa (cadastro e configurações do perfil), guardados na conta para valer em qualquer aparelho.
ALTER TABLE "User" ADD COLUMN "tastes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
