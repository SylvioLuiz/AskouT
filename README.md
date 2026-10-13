# AskouT

Menos tempo combinando. Mais tempo juntos.

## Estado atual (Fase 1)

| Item | Estado |
|---|---|
| `packages/availability-engine` (compatibilidade de agendas) | **implementado e testado** (15 testes) |
| `apps/api/src/core` (cadastro com código por e-mail, login, perfil, seguir, bloquear, amizade) | **implementado e testado** (tipos limpos) |
| Suíte de contrato dos repositórios (`core/testing/contracts.ts`) | **passa em memória e contra um Postgres 16 real** (168 testes no total) |
| Repositórios Prisma (`apps/api/src/infra/prisma`) | **validados contra Postgres real** pela suíte de contrato |
| Camada HTTP NestJS (`apps/api/src/http`) | **sobe e responde**: teste de fumaça por HTTP (`npm run smoke`, 45 verificações) passa contra Postgres real; `typecheck:full` limpo. Falta endurecer para produção (ver limitações) |
| `apps/api/prisma/schema.prisma` + migration `init` | **aplicados em Postgres real** (a migration está em `prisma/migrations`) |
| View `friendships` + restrições (SQL) | **aplicados em Postgres real** (`prisma/sql/001_...sql`, depois da migration) |
| Agenda: serviço de disponibilidade (`core/availability-service.ts`), repositório Prisma e rotas HTTP | **validado contra Postgres real**: 168 testes (20 de contrato Prisma) e teste de fumaça por HTTP com 45 verificações, sem falhas |
| App web mobile-first (`apps/web`): conta, perfil, seguir, bloquear, Agenda, Encontrar melhor data | **verificado em navegador real** contra o núcleo em memória (celular 390 px). `typecheck`/`build` do Vite ainda a conferir na sua máquina |
| Flash (disponível agora): núcleo, repositório Prisma, rotas HTTP e limpeza periódica | núcleo e rotas **testados em memória** (174 testes) e a tela **verificada em navegador de celular** (39 verificações). O repositório Prisma e a migração `flash` **ainda não foram executados em Postgres real**: dependem de você rodar os passos da seção "Flash" abaixo |
| Flash: mapa com pins (MapLibre + OpenStreetMap) | **não iniciado** (etapa B). Hoje o encontro mostra a distância e um link "Abrir no mapa" |
| Painéis de bares e admin, app nativo | **não iniciados** |

Nada acima é simulado: o que consta como implementado roda e tem teste. O que consta como "escrito, não executado", "não iniciado" ou "não validado" não deve ser tratado como pronto. Sem banco, os testes em memória rodam (174 hoje) e os de contrato do Prisma/Postgres aparecem como `SKIP`; com `ASKOUT_TEST_DATABASE_URL` apontando para um banco de teste, os de Postgres também rodam (incluindo os 8 de Flash, ainda não executados em Postgres real).

## Rodar os testes

Requer Node 22 ou mais novo. Os testes comuns não precisam de banco de dados.

    # motor de compatibilidade
    cd packages/availability-engine && npm test

    # API (núcleo + partes puras da camada HTTP)
    cd apps/api && npm test

Checagem de tipos (precisa de `npm install` na raiz, para `typescript` e `@types/node`):

    npm install
    npm run typecheck

## Banco de dados e testes contra Postgres

Já validado em Postgres 16 (Postgres.app no macOS). Com Docker, `docker compose up -d` sobe o mesmo banco.

    cd apps/api
    npm install
    cp .env.example .env            # preencha JWT_SECRET e CODE_SECRET; ajuste DATABASE_URL
    createdb askout && createdb askout_test
    npx prisma migrate deploy       # cria as tabelas (use migrate dev ao alterar o schema)
    psql askout -v ON_ERROR_STOP=1 -f prisma/sql/001_friendships_and_constraints.sql

Para o banco de teste, repita `migrate deploy` e o `psql` com `DATABASE_URL` apontando para `askout_test`. Depois:

    ASKOUT_TEST_DATABASE_URL=postgresql://USUARIO@localhost:5432/askout_test npm test

**Atenção:** esses testes APAGAM todos os dados do banco de teste a cada caso. Por segurança eles recusam rodar se o nome do banco não terminar em `_test`.

## Subir a API e testar por HTTP

    cd apps/api
    # preencha JWT_SECRET e CODE_SECRET no .env (valores diferentes, 32+ caracteres)
    npx tsx --tsconfig tsconfig.build.json src/http/main.ts > ~/askout-api.log 2>&1 &
    npm run smoke        # cadastra 3 usuários novos e confere cadastro, login, seguir, privado e bloqueio

`npm run dev` faz o mesmo com reinício automático a cada alteração de arquivo. Em desenvolvimento o código de cadastro não é enviado por e-mail: aparece no log da API (`[DEV e-mail]`), que é de onde o teste de fumaça o lê.

## Flash (disponível agora)

O Flash avisa os amigos que você está livre **agora** (a Agenda é para o futuro). Regras implementadas:

- Liga por 1, 2 ou 3 horas, com recado opcional de até 60 caracteres. Um Flash por pessoa; desligar cancela convites e encerra encontros.
- Para ver quem está livre você também precisa estar com o Flash ligado. A lista só traz **amigos** e, antes do aceite, **só nome, foto e recado**: nunca localização.
- Convite vale 15 minutos (ou até um dos Flash acabar). Quem recebe aceita ou recusa. **Só depois do aceite** os dois passam a ver a posição um do outro, e só durante o encontro.
- Guardamos apenas a **última** posição de cada um (sem histórico). Ela é considerada "sem sinal" após 120 s sem atualização e é apagada quando o encontro acaba, o Flash desliga, o convite vence ou há bloqueio.
- Bloquear (na lista, no convite ou no encontro) encerra tudo entre os dois. Uma limpeza roda a cada minuto na API e também na leitura.
- No navegador a localização só funciona em **conexão segura (https ou localhost)**. Testar no celular por `http://192.168...` não libera o GPS: é preciso https.

Para ativar no seu banco (depois de `git pull` e `npm install`):

    cd apps/api
    npm run prisma:migrate -- --name flash                        # cria as tabelas do Flash
    npx prisma db execute --file prisma/sql/002_flash_constraints.sql --schema prisma/schema.prisma
    # repita os dois comandos com DATABASE_URL apontando para askout_test (use `npx prisma migrate deploy` no lugar do primeiro)

## Rotas da API

Sem token: `POST /auth/signup`, `POST /auth/signup/resend`, `POST /auth/signup/confirm`, `POST /auth/login`. Todas as outras exigem `Authorization: Bearer <token>`.

| Rota | O que faz |
|---|---|
| `GET /auth/me` | usuário da sessão |
| `GET /profiles/search?q=&limit=` · `GET /profiles/:username` | busca e perfil |
| `PATCH /profiles/me` · `PATCH /profiles/me/privacy` | editar perfil, tornar privado/público |
| `POST/DELETE /users/:userId/follow` | seguir / deixar de seguir |
| `GET /users/:userId/followers` · `.../following` | listas (`limit`, `offset`) |
| `GET /me/follow-requests` · `POST /me/follow-requests/:userId/approve` · `.../reject` | solicitações pendentes |
| `DELETE /me/followers/:userId` · `GET /me/friends` | remover seguidor, amigos |
| `POST/DELETE /users/:userId/block` · `GET /me/blocks` | bloqueios |
| `GET/POST /me/availability` · `DELETE /me/availability/:slotId` | meus horários (disponível, parcial, indisponível); não podem se sobrepor |
| `GET /users/:userId/availability?from=&to=` | agenda de um amigo (só amigos; 403 para os demais) |
| `POST /compatibility` | compatibilidade de um horário entre você e até 9 amigos |
| `POST /compatibility/best-dates` | "Encontrar melhor data": o melhor horário de cada dia, do mais ao menos compatível |
| `GET/POST/DELETE /me/flash` | estado do meu Flash, ligar (`{hours: 1\|2\|3, note?}`), desligar |
| `GET /flash/available` | amigos com Flash ligado (exige o seu ligado); sem localização |
| `GET/POST /flash/invites` | meus convites (recebidos, enviados, encontros) / convidar (`{userId}`) |
| `POST /flash/invites/:id/respond` · `DELETE /flash/invites/:id` | aceitar ou recusar (`{action}`) / cancelar ou encerrar |
| `GET /flash/matches/:id` · `PUT /flash/matches/:id/location` | encontro aceito: posição dos dois / enviar a minha (`{lat, lng, accuracyM?}`) |

Erros: `{ "error": { "code", "message", "details?" } }` com status 400/401/403/404/409/429 (429 envia `Retry-After`). Erro inesperado vira 500 genérico, sem vazar detalhes.

## App web (`apps/web`)

React 19 + Vite 7 + TypeScript. Telas: entrar, criar conta (2 passos com código por e-mail), Home (amigos), Explorar (busca), Atividades (pedidos para seguir), perfil de outras pessoas (seguir, pedir, deixar de seguir, bloquear), Meu perfil (editar, privacidade), Amigos, Bloqueados. Agenda (faixa de 28 dias, folha "Marcar horário", agenda do amigo) e "Encontrar melhor data" (escolher amigos, período, duração e horário de início). Flash (raio no topo e botão grande na Home): ligar por 1/2/3 h, livres agora, convidar, aceitar/recusar, encontro com distância e bloquear. Conversas aparece como "em breve".

Rodar (a API precisa estar de pé em `localhost:3000`, veja acima):

```
cd apps/web
npm install
npm run dev        # abre em http://localhost:5173 (o Vite encaminha /api para a API)
npm test           # testes da camada de lógica (sem navegador)
npm run typecheck
```

O código de confirmação do cadastro aparece no log da API (e-mail de desenvolvimento).

Estado de verificação: a lógica foi testada (26 testes) e o app foi exercitado num navegador real contra o núcleo da API em memória (32 verificações, celular e desktop). **`npm run typecheck` e `npm run build` ainda não foram rodados** — o ambiente onde isto foi escrito não conseguia instalar `@types/react`; a primeira execução na sua máquina é a verificação de tipos de verdade.

Não feito ainda: modo escuro, páginas de termos e privacidade (dependem de texto jurídico real), Home com feed, Conversas.

As datas da agenda usam o fuso do aparelho. `npm test` fixa `TZ=America/Sao_Paulo` para os testes de data.

## Núcleo da API (`apps/api/src/core`)

Regras de negócio em TypeScript puro, sem framework e sem banco. O acesso a dados e a criptografia ficam atrás de interfaces (`ports.ts`), então NestJS e Prisma entram depois só como adaptadores, sem mexer nas regras.

| Arquivo | O que faz |
|---|---|
| `auth-service.ts` | cadastro em duas etapas com código por e-mail, login por e-mail ou @usuario, validação de sessão (`authenticate`) |
| `profile-service.ts` | ver perfil (com relação e `canViewContent`), editar, privacidade, busca |
| `follow-service.ts` | seguir, deixar de seguir, aprovar, recusar, remover seguidor, listas, amigos, `areFriends` |
| `block-service.ts` | bloquear, desbloquear, listar |
| `friendship.ts` | regra de amizade (seguimento mútuo aceito, sem bloqueio) |
| `adapters/crypto.ts` | senha com scrypt, token JWT HS256 e códigos de confirmação (HMAC) usando só `node:crypto` |
| `testing/` | repositórios em memória, relógio e ids de teste, e a suíte de contrato que vale para qualquer repositório |

Regras principais, todas cobertas por testes:

- **Amizade** = os dois se seguem com seguimento aceito, e não há bloqueio em nenhum sentido. Outros módulos (Flash, agenda, encontros) devem chamar `FollowService.areFriends` e `listFriends`, nunca reimplementar a regra.
- **Perfil privado:** seguir gera solicitação pendente; só o dono aprova ou recusa. Listas de seguidores e seguindo de conta privada só aparecem para o dono e seguidores aprovados. Conteúdo futuro (publicações) deve usar `canViewContent` do perfil.
- **Bloqueio** remove seguimentos e solicitações nos dois sentidos. Quem foi bloqueado não encontra o perfil nem aparece na busca. A ordem de gravação (bloqueio primeiro) mantém o estado seguro mesmo se a limpeza falhar.
- **Cadastro (estilo Instagram):** a pessoa envia e-mail, @usuario, nome e senha; recebe um código de 6 dígitos por e-mail (vale 10 minutos); só ao confirmar o código a conta é criada e a sessão é aberta. E-mail ou @usuario já em uso são avisados logo na primeira etapa. Limites: 5 tentativas erradas por código, 60 segundos entre envios, 5 envios por janela de cadastro. O e-mail nunca aparece no perfil público.
- **Login** por e-mail ou por @usuario. Não revela se a conta existe (mesma resposta e mesmo custo de hash) e só informa conta suspensa a quem acertou a senha.
- **Sessão:** o token é conferido contra o banco a cada chamada, então suspensão e mudança de papel valem na hora.

Os testes foram checados também quebrando as regras de propósito (por exemplo, ignorar bloqueio na amizade, aceitar seguimento pendente, pular a checagem de expiração do token): cada quebra faz pelo menos um teste falhar.

## Decisões que precisam da sua validação

1. **Token de acesso** vale 1 hora e não há renovação (refresh token) ainda.
2. **Aviso de e-mail já em uso** na primeira etapa do cadastro, como o Instagram faz (permite descobrir quem tem conta; os limites de envio e tentativa ajudam, mas o limite por IP precisa ser feito na camada HTTP).
3. **Perfil nasce público.** Ao tornar público um perfil privado, as solicitações pendentes são aceitas automaticamente.
4. **Username não muda** depois do cadastro (por enquanto). Limites: nome até 50 caracteres, biografia até 150, foto só por `https`.
5. **Segredo e custo:** o segredo do token precisa ter 32+ caracteres, vindo de variável de ambiente. O custo do scrypt é 2^15; vale ajustar conforme o servidor.

## Limitações conhecidas

- O ambiente onde isto foi escrito não conseguia baixar pacotes do npm, por isso NestJS, Prisma e o acesso real ao banco **não foram construídos nem testados**. A criptografia usa `node:crypto` (scrypt e HMAC); quando houver acesso ao npm, dá para trocar por argon2id e uma biblioteca de JWT, atrás das mesmas interfaces.
- **A camada HTTP não tem limite de requisições por IP nem cabeçalhos de segurança (Helmet).** Os limites do cadastro (tentativas, reenvio) existem no núcleo, mas o limite por IP e contra força bruta no login precisam ser feitos antes de ir para produção.
- Em produção a API **recusa subir** com o envio de e-mail "console" (ele imprime os códigos no log).
- O NestJS roda em ESM importando pacotes CommonJS; isso costuma funcionar, mas é um dos pontos que a validação na sua máquina precisa confirmar.
- **Agenda:** os horários são avulsos (sem repetição semanal), não há integração com Google/Apple Calendar e ainda não existem encontros nem convites: hoje a pessoa vê a compatibilidade, mas não cria o encontro. Cada horário vai até 24 h, no máximo 300 ativos por pessoa.
- **`@askout/availability-engine` é consumido como código TypeScript do workspace** (funciona em `npm run dev` e nos testes). O `npm run build` + `npm start` a partir de `dist/` ainda não resolve esse pacote: falta compilar o motor. Resolver antes de publicar.
- Não há ainda limite de tentativas de login, recuperação de senha nem troca de e-mail. **O envio real de e-mail não existe**: o núcleo usa uma interface (`EmailSender`); falta escolher o provedor (decisão sua, tem custo).
- **Flash:** a posição só é enviada com a tela do encontro aberta (navegador não envia em segundo plano; o app nativo resolve isso depois). Convites e posições são atualizados por consulta a cada 8–10 s, não por conexão em tempo real. Ainda não há mapa, nem aviso quando alguém te convida fora do app.
- `total` nas listas de seguidores pode incluir pessoas ocultas por bloqueio de terceiros.

## Próximos passos

1. Escolher o provedor de e-mail e implementar o envio real; limite por IP e Helmet (hoje só o cadastro tem limites, no núcleo).
2. Front end web: cadastro, login, perfil, seguir e bloquear consumindo estas rotas.
3. Limite de tentativas, verificação de e-mail, recuperação de senha, refresh token.
4. Fase 2 (em andamento): agenda manual e comparação **feitas**; Flash **feito sem mapa** (etapa A); faltam o mapa do Flash, encontros e convites a partir do melhor horário, repetição semanal, conversas e grupos.
5. Compilar o motor de compatibilidade para o build de produção da API.

## Regras do motor de compatibilidade (confirmadas)

Por participante, para o intervalo proposto:
1. Indisponibilidade manual explícita prevalece.
2. Compromisso externo ocupado gera conflito.
3. Disponibilidade manual cobrindo o intervalo inteiro = disponível; cobrindo só parte = parcial.
4. Sem informação = não informado (nunca indisponível).

Classificação do intervalo:
- qualquer participante sem informação: **Aguardando informações**
- todos disponíveis: **Verde**
- (disponíveis + parciais) >= metade: **Laranja**
- demais casos: **Vermelho**

Ordenação do "Encontrar melhor data": verde, laranja, aguardando, vermelho; depois mais disponíveis, mais parciais, menos sem informação e, por último, o horário mais cedo.
