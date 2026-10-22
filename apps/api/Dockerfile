# API do AskouT. Contexto de construção = raiz do repositório:
#   docker build -f apps/api/Dockerfile -t askout-api .
# NÃO foi construída nem rodada ainda (o ambiente de desenvolvimento não tem Docker em funcionamento): ver deploy/README.md.
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Só os package.json primeiro, para o cache das dependências.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/admin/package.json apps/admin/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY packages/availability-engine/package.json packages/availability-engine/package.json
RUN npm ci --workspace=@askout/api --include-workspace-root --include=dev

COPY packages packages
COPY apps/api apps/api
RUN npx prisma generate --schema apps/api/prisma/schema.prisma

ENV NODE_ENV=production
EXPOSE 3000
# Aplica as migrações pendentes e sobe a API. A porta vem da variável PORT (a hospedagem define).
CMD ["sh", "-c", "npx prisma migrate deploy --schema apps/api/prisma/schema.prisma && exec npx tsx --tsconfig apps/api/tsconfig.build.json apps/api/src/http/main.ts"]
