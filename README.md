# AskouT

Menos tempo combinando. Mais tempo juntos.

## Estado atual (Fase 1)

| Item | Estado |
|---|---|
| `packages/availability-engine` (compatibilidade de agendas) | **implementado e testado** (15 testes) |
| `apps/api/src/core` (cadastro com código por e-mail, login, perfil, seguir, bloquear, amizade) | **implementado e testado** (tipos limpos) |
| Suíte de contrato dos repositórios (`core/testing/contracts.ts`) | **roda e passa nos repositórios em memória**; contra Postgres só roda na sua máquina (ver abaixo) |
| Repositórios Prisma (`apps/api/src/infra/prisma`) | **escritos, NÃO executados**: só passaram na checagem de tipos com um stub do Prisma |
| Camada HTTP NestJS (`apps/api/src/http`) | **escrita, NÃO executada**: o NestJS não pôde ser instalado onde isto foi escrito. Partes sem Nest (config, mapeamento de erros, leitura de parâmetros) têm testes e passam |
| `apps/api/prisma/schema.prisma` | escrito, **ainda não validado** com `prisma validate` |
| View `friendships` + restrições (SQL) | escrito, **ainda não executado** em um Postgres |
| Front end (web, painéis, design system) | **não iniciado** |

Nada acima é simulado: o que consta como implementado roda e tem teste. O que consta como "escrito, não executado", "não iniciado" ou "não validado" não deve ser tratado como pronto. Os 130 testes que rodam sem banco passam; os do Prisma/Postgres aparecem como `SKIP` até você configurar o banco de teste.

## Rodar os testes

Requer Node 22 ou mais novo. Os testes comuns não precisam de banco de dados.

    # motor de compatibilidade
    cd packages/availability-engine && npm test

    # API (núcleo + partes puras da camada HTTP)
    cd apps/api && npm test

Checagem de tipos (precisa de `npm install` na raiz, para `typescript` e `@types/node`):

    npm install
    npm run typecheck

## Validar o que ainda não foi executado (na sua máquina)

Estes passos fecham as lacunas da tabela acima. **Se algo falhar, me envie a saída completa do erro**: é esperado que apareçam ajustes, já que esse código nunca rodou.

    cd apps/api
    npm install
    cp .env.example .env          # preencha JWT_SECRET e CODE_SECRET (veja o comando no arquivo)
    docker compose up -d          # Postgres local
    npx prisma validate           # 1. valida o schema
    npx prisma generate
    npx prisma migrate dev --name init
    # aplicar também prisma/sql/001_friendships_and_constraints.sql (restrições e view)

    # 2. contrato dos repositórios contra o Postgres real. Use um banco SEPARADO terminado em _test:
    #    os testes apagam todos os dados dele (e recusam rodar em banco com outro nome).
    #    (crie o banco askout_test e rode o migrate nele com DATABASE_URL apontando para ele)
    ASKOUT_TEST_DATABASE_URL=postgresql://askout:askout@localhost:5432/askout_test npm test

    # 3. checagem de tipos completa, com NestJS e Prisma reais
    npm run typecheck:full

    # 4. subir a API
    npm run dev

## Rotas da API (camada HTTP, ainda não executada)

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

Erros: `{ "error": { "code", "message", "details?" } }` com status 400/401/403/404/409/429 (429 envia `Retry-After`). Erro inesperado vira 500 genérico, sem vazar detalhes.

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
- Não há ainda limite de tentativas de login, recuperação de senha nem troca de e-mail. **O envio real de e-mail não existe**: o núcleo usa uma interface (`EmailSender`); falta escolher o provedor (decisão sua, tem custo).
- `total` nas listas de seguidores pode incluir pessoas ocultas por bloqueio de terceiros.

## Próximos passos

1. Você rodar a seção "Validar o que ainda não foi executado" e me trazer os erros; eu corrijo até o contrato passar no Postgres e a API subir.
2. Escolher o provedor de e-mail e implementar o envio real; limite por IP e Helmet.
3. Limite de tentativas, verificação de e-mail, recuperação de senha, refresh token.
4. Fase 2: expansão de recorrência, agenda manual, encontros e convites usando o motor, conversas, grupos e Flash.
5. Design system e navegação do app web.

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
