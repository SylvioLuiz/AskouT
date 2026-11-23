# AskouT Hunter: passagem para quem desenvolve junto

Atualizado em 23/11/2026. O Hunter descobre eventos na internet e os publica no AskouT. Detalhes e decisões datadas estão em `GOLIVE.md` (seção "AskouT Hunter").

## Decisões do Sylvio (valem para tudo)
- **Sistema separado:** repositório próprio (`AskouT-Hunter`, privado), deploy, banco (`hunter_*`) e painel próprios. Nada do Hunter entra neste repositório além da ponte abaixo. Motivo: todo push na `main` daqui dispara build do iOS.
- **Desligável:** o AskouT tem um liga/desliga (aba Hunter na gestão). Desligado, a API recusa o Hunter na hora.
- **Começa em modo observação:** nada é publicado sozinho no início; tudo passa por revisão.
- **Sem evento sem local, por enquanto:** ficam numa seção separada do painel do Hunter. **Lembrar de liberar depois.** `PlaceEvent` exige `venueId`; ao liberar, decidir entre local sem dono escondido das buscas ou mudar o modelo.
- **Imagem:** a do evento na fonte vira a capa, com crédito. O Sylvio assumiu o risco de direitos. Nunca foto do Google Places, nunca contornar bloqueio de fonte. Sem imagem válida, o evento fica abaixo de 90% e vai para revisão.
- **Confiança (pesos iniciais, configuráveis):** data e hora 25, local 25, fonte oficial 20, imagem 15, coerência 10, várias fontes 5.
- **IA:** Google Gemini (AI Studio, plano gratuito) como conector trocável. Só texto público de eventos, nunca dado de usuário. Falha e limite são esperados: cai para revisão, nunca publica sem extração. `GEMINI_API_KEY` só no serviço do Hunter, só na Fase 3.
- **Google Places:** não guardar dados do Google, só o Place ID (`Venue.externalKey = google:ID`).

## O que já existe neste repositório (ponte)
- **Regra de propriedade** (`apps/api/src/core/automated-publish-gate.ts`): local com dono ou pedido de reivindicação pendente nunca recebe evento automático. Vale também para o importador `scripts/import-real-events.ts`.
- **Ponte** (`core/hunter-bridge.ts`, `http/hunter/`): tabela própria `HunterEventLink`, flag `hunter.enabled` em `AppSetting`, autenticação por `Authorization: Bearer $HUNTER_SERVICE_TOKEN` (32+ caracteres). Criação é idempotente por `ref`.
  - `GET /hunter/status`, `GET /hunter/venues`, `GET /hunter/regions` (agregado por grade de 0,1°, mínimo de 3 usuários)
  - `POST /hunter/events`, `GET/PATCH /hunter/events/:ref`, `POST /hunter/events/:ref/cancel`
  - Erros: 503 `HUNTER_DISABLED` / `HUNTER_NOT_CONFIGURED`; 403 `HUNTER_OWNED` / `HUNTER_CLAIM_PENDING` / `HUNTER_UNKNOWN`
- **Gestão** (`apps/admin/src/pages/hunter.tsx`, rotas `/admin/hunter`): liga/desliga, lista do que o Hunter cadastrou, remover um ou todos. Tudo auditado.
- Validação do evento: https em imagem e ingresso, fim depois do início e no futuro, título até 120, descrição até 1500, até 8 tags.

## Falta fazer
1. **Deploy da API no Render** (manual, precisa do login do Sylvio): aplica as migrações pendentes (`hunter_bridge`, `comment_replies`, SQL 025). Nunca rodaram no Postgres de produção.
2. **`HUNTER_SERVICE_TOKEN`** no Render. Sem ele o botão Ligar fica desabilitado.
3. **Repositório `AskouT-Hunter`**: o Sylvio precisa criá-lo vazio e privado. Depois: esqueleto (painel, worker, `hunter_*`, auth de serviço), conectores (migrar os importadores atuais), conector Gemini, fila às 06h e 18h (America/Sao_Paulo), deduplicação, nota de confiança, fila de revisão, publicação, custo, seção de eventos sem local.

## Divisão de funções (nov/2026): o Hunter descobre, a gestão publica

- **Hunter** (repo AskouT-Hunter): coleta, filtra, pontua e guarda candidatos; o painel dele aprova/rejeita. Não grava mais no AskouT. Expõe `GET /export` (candidatos aprovados, status PUBLISH) e `POST /export/ack` com `Authorization: Bearer $HUNTER_EXPORT_TOKEN`.
- **AskouT (API/gestão)**: o job `HunterSync` (`http/hunter/hunter-feed.ts`, a cada 10 min, e o botão "Buscar agora" na aba Hunter) lê `/export`, acha o local, aplica a regra de propriedade, barra duplicado (mesmo título + local + dia no AskouT → `DUPLICATE`) e cria o evento pela ponte (`core/hunter-sync.ts`). Devolve ao Hunter `PUBLISHED`, `REVIEW` (local sem cadastro/com dono, dado inválido) ou `REJECTED` (duplicado).
- **Variáveis no servidor da API (Render `askout-api`)**: `HUNTER_URL=https://hunter.askout.com.br` e `HUNTER_EXPORT_TOKEN` (32+ caracteres, o mesmo valor no serviço `askout-hunter`). Sem elas a busca fica inativa. O interruptor da aba Hunter continua mandando: desligado, a gestão não busca nem publica.
- O token `HUNTER_SERVICE_TOKEN` segue valendo para o Hunter consultar locais (`/hunter/venues`, `/hunter/regions`) ao pontuar; a rota de criar evento fica sem uso pelo Hunter.
