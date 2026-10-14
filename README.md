# AskouT

Menos tempo combinando. Mais tempo juntos.

## Estado atual (Fase 1)

| Item | Estado |
|---|---|
| `packages/availability-engine` (compatibilidade de agendas) | **implementado e testado** (15 testes) |
| `apps/api/src/core` (cadastro com código por e-mail, login, perfil, seguir, bloquear, amizade) | **implementado e testado** (tipos limpos) |
| Suíte de contrato dos repositórios (`core/testing/contracts.ts`) | **passa em memória e contra um Postgres 16 real** (202 testes no total) |
| Repositórios Prisma (`apps/api/src/infra/prisma`) | **validados contra Postgres real** pela suíte de contrato |
| Camada HTTP NestJS (`apps/api/src/http`) | **sobe e responde**: teste de fumaça por HTTP (`npm run smoke`, 79 verificações, incluindo o Flash) passa contra Postgres real; `typecheck:full` limpo. Falta endurecer para produção (ver limitações) |
| `apps/api/prisma/schema.prisma` + migration `init` | **aplicados em Postgres real** (a migration está em `prisma/migrations`) |
| View `friendships` + restrições (SQL) | **aplicados em Postgres real** (`prisma/sql/001_...sql`, depois da migration) |
| Agenda: serviço de disponibilidade (`core/availability-service.ts`), repositório Prisma e rotas HTTP | **validado contra Postgres real**: 168 testes (20 de contrato Prisma) e teste de fumaça por HTTP com 45 verificações, sem falhas |
| App web mobile-first (`apps/web`): conta, perfil, seguir, bloquear, Agenda, Encontrar melhor data | **verificado em navegador real** contra o núcleo em memória (celular 390 px). `typecheck`/`build` do Vite ainda a conferir na sua máquina |
| Flash (disponível agora): núcleo, repositório Prisma, rotas HTTP e limpeza periódica | núcleo e rotas **testados em memória** (174 testes) e a tela **verificada em navegador de celular** (39 verificações). O repositório Prisma e a migração `flash` **ainda não foram executados em Postgres real**: dependem de você rodar os passos da seção "Flash" abaixo |
| Conversas entre amigos + sugestões de lugares no encontro Flash | núcleo, rotas e telas **testados em memória** (202 testes de API, 56 de web, 43 verificações em navegador de celular simulado). O repositório Prisma, a migração `conversations_places` e a busca real no OpenStreetMap (Overpass) **ainda não foram executados na sua máquina**: dependem dos passos da seção "Conversas e sugestões" |
| Flash: mapa com pins (MapLibre + OpenStreetMap) | **confirmado funcionando no celular** (https, MapLibre real, tiles do OpenStreetMap), além de verificado contra um dublê do `maplibre-gl` no navegador de teste |
| Painéis de bares e admin, app nativo | **não iniciados** |

Nada acima é simulado: o que consta como implementado roda e tem teste. O que consta como "escrito, não executado", "não iniciado" ou "não validado" não deve ser tratado como pronto. Sem banco, os testes em memória rodam (174 hoje) e os de contrato do Prisma/Postgres aparecem como `SKIP`; com `ASKOUT_TEST_DATABASE_URL` apontando para um banco de teste, os de Postgres também rodam (202 no total, incluindo os de Flash, já executados em Postgres real).

## Subir tudo com um comando

    npm run dev:all             # na raiz: confere o Postgres (abre o Postgres.app se preciso), libera as portas 3000/5173, sobe API e web
    npm run dev:all -- --https  # igual, com https para testar a localização no celular

No Mac também dá para dar dois cliques em `scripts/AskouT.command`: ele confere o GitHub e, se houver novidade, roda o `npm run update` antes de subir (sem internet, sobe direto com o que já está aí). A saída da API vai para `~/askout-api.log`, que o `npm run smoke` lê. Banco, API e app rodam na sua máquina, então cair a internet não derruba nada (só os tiles do mapa precisam dela). Este script foi verificado só até a checagem do Postgres; a subida completa ainda precisa ser confirmada no seu Mac.

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
- No navegador a localização só funciona em **conexão segura (https ou localhost)**. Para testar no celular use `npm run dev:all -- --https` (certificado autoassinado, aceite o aviso do navegador) e abra o endereço `https://IP-DO-MAC:5173` que o Vite mostra em "Network". Verificado no seu iPhone.
- O mapa usa os tiles públicos do OpenStreetMap, ok para desenvolvimento; em produção é preciso um provedor de tiles próprio ou contratado (a política do OSM não permite uso pesado). Cada tile pedido expõe o IP de quem abre o mapa a esse provedor.

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
| `GET /flash/matches/:id/suggestions` | eventos e lugares perto do ponto médio entre os dois (até 3 km); 409 se um dos dois não compartilhou a localização |
| `GET/POST /conversations` | minhas conversas (com não lidas) / abrir a conversa com um amigo (`{userId}`) |
| `POST /conversations/:id/messages/:messageId/respond` · `GET /places/photo` | aceitar/recusar o lugar (`{action}`) / foto do lugar (endereço assinado) |
| `GET/POST /conversations/:id/messages` · `POST /conversations/:id/read` | mensagens (`limit`, `before`) / enviar `{body}` ou `{suggestion}` / marcar como lida |
| `GET /explore?q=&lat=&lng=&radiusKm=&from=&to=&kind=&free=` | Explorar: sem `q`, eventos perto; com `q`, eventos, locais, pessoas e `#`. `kind`: DIGITAL, SHOW, CINEMA, THEATER, EXHIBITION, GASTRONOMY, NIGHT, OTHER |
| `GET /events/:id?lat=&lng=` | um evento (com distância se enviar a posição) |
| `GET /flash/matches/:id` · `PUT /flash/matches/:id/location` | encontro aceito: posição dos dois / enviar a minha (`{lat, lng, accuracyM?}`) |

Erros: `{ "error": { "code", "message", "details?" } }` com status 400/401/403/404/409/429 (429 envia `Retry-After`). Erro inesperado vira 500 genérico, sem vazar detalhes.

## Conversas e sugestões

- **Conversas 1 a 1, só entre amigos.** Aceitar um convite do Flash cria (ou reaproveita) a conversa dos dois; ela continua depois que o Flash acaba. Quem deixa de ser amigo mantém o histórico legível, mas não envia. Bloqueio esconde a conversa dos dois lados; desbloquear traz o histórico de volta. Limite de 30 mensagens por minuto e 2000 caracteres.
- **Carrossel de sugestões** (só durante um encontro Flash ativo, e só quando os dois compartilharam a localização): o servidor calcula o **ponto médio** entre as duas últimas posições e busca num raio de **3 km**: primeiro **eventos do AskouT** (em andamento ou nas próximas 12 h), depois completa com **lugares do OpenStreetMap** (bares, cafés, restaurantes) até 10. Cada cartão mostra a fonte, o horário (ou "Horário não informado") e as distâncias. Se estiverem a mais de 20 km um do outro, não há sugestão. A resposta **nunca traz a posição das pessoas**; o cartão enviado na conversa também não.
- **Aceitar o lugar e rota:** o cartão na conversa mostra a distância em linha reta de cada um até o lugar (calculada na hora, **só enquanto o encontro Flash está ativo** e os dois compartilham a localização; nada é guardado), "Rota até lá" (abre o app de mapas, a pé, a partir de onde a pessoa estiver) e, para quem recebeu, **Aceitar / Recusar**. Só uma resposta por cartão; quem sugeriu vê "Aguardando" e depois o resultado.
- **Google Places (nota, estrelas e foto):** implementado e **desligado até existir chave** (`GOOGLE_PLACES_API_KEY` no `.env` da API; `GOOGLE_DAILY_LIMIT`, padrão 500 buscas/dia, evita estourar o crédito sem perceber). Com chave, os lugares vêm do Google (com nota, avaliações e foto, crédito "Google" na tela) e o OpenStreetMap vira reserva. Seguimos os termos do Google: os dados ficam só na memória da requisição (**nada de nota, foto ou descrição vai para o banco**; no cartão enviado fica só nome e coordenadas do lugar que a pessoa escolheu), a foto é baixada pelo servidor e entregue por endereço assinado com validade de 30 min (a chave nunca vai ao app). **Ainda não foi testado com o Google de verdade** (sem chave); só com dublê. Antes de publicar, conferir os termos atuais do Google sobre exibir os dados e sobre o mapa usado ao lado deles.
- **Reivindicar um bar (planejado, não implementado):** o dono pede para assumir um lugar; a prova é em etapas: (1) código enviado ao telefone público do bar; (2) se não der, documento (CNPJ/alvará e comprovante) com revisão de um admin. Depende do painel do local (posts, perfil do bar) e do painel admin, que ainda não existem, e de um provedor de SMS/voz (custo).
- **Eventos de exemplo:** ainda não existe cadastro real de eventos (painel do local). Para testar, `cd apps/api && npm run seed:places -- --lat <sua latitude> --lng <sua longitude>` cria 6 lugares com eventos marcados como **[TESTE]** e com o selo "Exemplo de teste" no app. `npm run seed:places -- --here` centraliza nas posições que o Flash acabou de receber (sem digitar coordenadas; compartilhe a localização num encontro antes); `npm run seed:places -- --clear` apaga todos. Nada disso é apresentado como real.
- **OpenStreetMap (Overpass):** consulta ao servidor público `overpass-api.de` com cache de 10 min e coordenada arredondada (~110 m); se não responder, o app mostra só os eventos do AskouT e avisa. O servidor público serve para desenvolvimento: em produção é preciso instância própria ou provedor contratado. Defina `OSM_CONTACT` (e-mail ou site) no `.env` da API para identificar o app, como a política do serviço pede. Crédito "© colaboradores do OpenStreetMap" aparece no carrossel.
- Passos na sua máquina: `git pull`, `npm run update` (aplica a migração `20261014120000_conversations_places` e as restrições `003_*.sql` nos dois bancos e roda os testes, inclusive os de contrato no Postgres), `npm run seed:places`, `npm run dev:all -- --https`, `npm run smoke`.

## Encontros e grupos

Na página de um evento, o botão **Criar encontro** (nome provisório; muda em `apps/web/src/lib/meetup.ts`) abre a escolha de amigos (só amigos, até 15).
- **Uma pessoa:** não há grupo. O convite é um cartão do encontro na conversa 1 a 1; a pessoa aceita ou recusa ali.
- **Várias pessoas:** cria-se um **grupo** (nome opcional; padrão: título do evento) onde o cartão do encontro fica. Cada convidado recebe o convite na conversa 1 a 1 com quem criou e **só entra no grupo ao aceitar**; quem recusa não entra e não vê o grupo.
- **Detalhes do grupo** (tocar no nome na conversa): **Pessoas**, **Eventos** (imagem, local, confirmados, data e hora) e **Mídia** (ainda não existe envio de mídia; a aba diz isso).
- Regras: só uma resposta por convite; não responde a encontro que já terminou; bloqueio impede convidar e aceitar; até 10 encontros criados por hora; no grupo só texto (sugestão de lugar do Flash continua só na conversa 1 a 1).
- Rotas: `POST /meetups` (`{eventId, guestIds, name?}`), `GET /meetups/:id`, `POST /meetups/:id/respond` (`{action}`), `GET /conversations/:id/group`.
- Passos na sua máquina: `git pull`, `npm run update` (migração `20261014210000_meetups_groups` e `006_meetup_constraints.sql`), `npm run dev:all -- --https`.
- **Gerenciar o grupo** (tela de detalhes): qualquer membro pode **Sair do grupo** (sai também dos encontros dele; se era quem criou, o grupo passa para quem entrou primeiro). Só quem criou **muda o nome**, **troca/remove a foto** e **remove pessoas**. A foto é reduzida no celular (256 px, JPEG, até 40 KB) e guardada no próprio banco como imagem embutida; não há armazenamento de arquivos nem moderação de imagem ainda. Cada mudança vira um aviso cinza no chat ("Fulano saiu do grupo").
- **Editar o encontro** (aba Eventos, só quem organiza, até ele acabar): mudar o nome, **convidar mais amigos** (quem já está no grupo não aparece; mais de 16 pessoas não) e **cancelar** (cartões e aba passam a mostrar "Cancelado").
- **Bloqueio dentro do grupo:** se alguém bloqueia outro membro, os dois deixam de ver as mensagens e a presença um do outro naquele grupo (o resto do grupo continua normal).
- Rotas novas: `POST /conversations/:id/leave`, `DELETE /conversations/:id/members/:userId`, `PUT /conversations/:id/group/name` (`{name}`), `PUT /conversations/:id/group/photo` (`{image: dataURL|null}`), `POST /meetups/:id/invite` (`{guestIds}`), `PATCH /meetups/:id` (`{title}`), `POST /meetups/:id/cancel`. Migração `20261014230000_group_management` e `007_group_constraints.sql` (rodam no `npm run update`).
- Ainda não existe: mídia.

## Avisos (sino e fora do app)

- **Sino (dentro do app):** cada aviso fica guardado no banco (tabela `Notification`). A tela **Atividades** lista as novidades (não lidas em destaque; tocar abre a tela certa e marca como lida; "Marcar tudo como lido") e, abaixo, os pedidos para seguir. A bolinha do sino aparece com avisos não lidos ou pedidos pendentes.
- **Quando avisa:** nova mensagem (1 a 1 ou grupo), convite de encontro, alguém aceitou ou cancelou o encontro, remoção do grupo, pedido para seguir e pedido aprovado, convite do Flash e Flash aceito. Mensagens seguidas na mesma conversa viram **um** aviso até você abrir. Quem bloqueou alguém não é avisado das mensagens dessa pessoa num grupo. **O texto da mensagem nunca vai no aviso** (só "enviou uma mensagem").
- **Fora do app (Web Push):** em Atividades, **Ativar avisos** pede a permissão do navegador e inscreve o aparelho (até 10 por pessoa; **Desligar neste aparelho** cancela). O servidor cifra o aviso (RFC 8291) e se identifica com VAPID (RFC 8292), tudo com `node:crypto`, sem biblioteca. O `npm run update` gera o par de chaves e grava `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` em `apps/api/.env` (só se faltarem); sem as chaves o push fica desligado e o app avisa isso.
- **O que foi testado e o que não foi:** a criptografia confere com o exemplo oficial do RFC 8291, a assinatura VAPID é verificada nos testes, e o fluxo de tela roda num navegador de teste com a parte do navegador simulada. **Ainda não foi testado com um serviço de push de verdade** (Chrome/Firefox/Safari): isso só dá para confirmar no seu aparelho.
- **Limites do navegador:** o push só funciona em conexão segura (`https` ou `localhost`). Com o certificado autoassinado do `dev:all -- --https`, o celular não registra o service worker; para testar no celular é preciso um endereço `https` confiável (ex.: um túnel). No iPhone/iPad só funciona com o AskouT adicionado à Tela de Início.
- Rotas: `GET /notifications`, `GET /notifications/unread`, `POST /notifications/read` (`{id?}`), `GET /notifications/push-key`, `POST /notifications/push` (`{endpoint, keys}`), `POST /notifications/push/remove` (`{endpoint}`). Migração `20261015120000_notifications_push` (roda no `npm run update`).

## Explorar

Ao abrir o Explorar o app pede a sua localização e já mostra, em mosaico de duas colunas, os eventos perto (padrão: hoje, 10 km). Quem quiser usa os filtros (Quando: hoje, amanhã, esta semana, fim de semana, próxima semana, este mês, próximos 30 dias; Tipo de evento; Grátis; Raio de 1 a 50 km) ou a barra de busca. Com texto, o resultado vem em abas **Tudo / Eventos / Locais / Pessoas / #**: eventos (título, local ou hashtag), locais do AskouT por nome, lugares de fora (Google ou OpenStreetMap, só com a localização liberada e sem filtro de tipo/grátis, até 10 km), pessoas (mesmas regras da busca de perfis: sem você e sem bloqueios) e hashtags. `#samba` busca só hashtags e os eventos com ela. Tocar num cartão abre o evento (`/eventos/:id`: quando, onde, distância, descrição, hashtags, rota).

- A localização vale só para a consulta e **não é guardada** (nem no banco, nem no aparelho). Sem permissão, os eventos aparecem sem distância.
- Evento tem tipo, "grátis", imagem (só `https`, enviada por quem criar o evento; nunca copiada do Google) e hashtags. Sem imagem, o cartão usa um degradê pelo tipo.
- Dados de exemplo continuam com o selo "Exemplo de teste". `npm run seed:places -- --here` agora cria 10 eventos de tipos, preços, hashtags e datas variados (hoje até daqui a 6 dias).
- Passos na sua máquina: `git pull`, `npm run update` (aplica a migração `20261014180000_explore_events` e `005_explore_constraints.sql`), `cd apps/api && npm run seed:places -- --here`, `cd ../.. && npm run dev:all -- --https`.

## Perfil, eventos postados e menu

- **Perfil** (o seu em `/perfil`, o de outras pessoas em `/u/:usuario`): foto, nome, @, descrição, números de seguidores, seguindo e eventos, e uma grade de duas colunas com os eventos que a pessoa postou. Perfil privado só mostra a grade a quem segue (com aprovação).
- **Postar um evento**: na página do evento, **Compartilhar** → *Postar no meu perfil* (ou *Tirar do meu perfil*). Na grade do seu perfil também dá para tirar. Rotas: `POST/DELETE /events/:id/post`, `GET /profiles/:usuario/events`.
- **Compartilhar** tem três opções: postar no perfil (feed), *Enviar em uma conversa* (cartão do evento para um amigo ou grupo, mensagem do tipo `EVENT`) e *Fora do app* (menu de compartilhar do aparelho; sem ele, copia o link `/eventos/:id`).
- **Editar perfil** (lápis no perfil): subir, trocar e remover a foto, nome e descrição. A foto é reduzida no aparelho (até 384 px, 56 KB) e guardada no banco (`ProfilePhoto`); é servida em `GET /users/:id/avatar` (pública, como em redes sociais; o endereço muda a cada troca).
- **Menu hambúrguer** (só no seu perfil): Configuração (e-mail, @, avisos no aparelho, amigos e bloqueados), Privacidade (perfil privado, pedidos, bloqueados), Suas interações (seus encontros, pedidos para seguir, eventos postados), Ajuda (perguntas frequentes), Tema (Automático, Claro, Escuro; guardado no aparelho) e Sair.
- Interpretações minhas: "postar" é um botão no evento, não uma tela de publicação; "Suas interações" junta encontros, pedidos e posts.
- Limites honestos: não dá para trocar e-mail ou senha ainda; não há canal de suporte (a Ajuda é um texto fixo); fotos ficam no banco, sem armazenamento de arquivos nem moderação; as rotas novas no Postgres só são testadas na sua máquina (`npm run update` aplica a migração `20261016120000_profile_posts` e `008_profile_constraints.sql`).

## Posts e o botão (+)

O botão **(+)** fica no meio da barra de baixo (no computador, "Criar post" no menu lateral) e abre `/criar`, em duas etapas:

1. **Seleção.** No topo, **Escolher fotos** (já selecionado) e **Foto de um lugar** se alternam; a seleção se mantém ao trocar. Há uma prévia grande, e abaixo a grade das fotos escolhidas (toque para pôr em destaque, × para tirar, + para adicionar). Em *Escolher fotos* o toque abre o seletor de fotos do sistema, que no celular já abre na galeria. Em *Foto de um lugar* você busca lugares perto de você e escolhe a foto do Google. **Avançar** leva à etapa 2.
2. **Detalhes.** Descrição (opcional, até 500 caracteres); **Lugar** (vem da foto do lugar; com fotos próprias, dá para vincular um lugar buscando); **Marcar pessoas** (só amigos, até 10); **Compartilhar** publica.

- **Recorte.** Na etapa 1, "Recortar esta foto" abre o recorte com os formatos do Instagram (**1:1**, **4:5**, **1,91:1**) e **Livre** (qualquer tamanho). Arraste a moldura e puxe os cantos; o recorte parte de uma cópia de até 1600 px, então dá para recortar de novo sem perder qualidade. Sem recorte, a foto segue inteira. No feed, o post usa a proporção da primeira foto (entre 4:5 e 1,91:1, como no Instagram) e as outras se ajustam a ela. Fotos de lugar (Google) não são recortadas.
- Um post tem de 1 a 5 fotos (no máximo uma foto de lugar). As fotos do aparelho são reduzidas antes de enviar (até 720 px e 95 KB cada) e ficam no banco (`Post`, `PostImage`). A foto de um lugar não é guardada: o post guarda só a referência, e a API busca no Google na hora de mostrar, com o crédito do autor; o endereço que o app manda é conferido pela assinatura emitida pela própria API.
- **Post ou Evento.** Na etapa 2, o seletor **Post | Evento** define o tipo. Evento pede nome, dia/hora de início (no futuro), fim opcional (padrão 3 h, máximo 24 h) e um lugar. Aparece com o selo "Evento" no post, no feed e na grade do perfil. Ao publicar, vai para a aba **Eventos** do perfil (a aba **Posts** só mostra posts comuns; `GET /profiles/:usuario/posts?kind=event|post`). É um post com dados de evento: ainda **não** vira encontro nem tem "Quero ir"; isso fica para o painel do local. Migração `20261019120000_post_events` e checagem no `009_post_constraints.sql`.
- **Marcação.** Quem foi marcado recebe um aviso e a marcação fica *pendente* (visível só para o autor e para o marcado). Em **Atividades → Marcações**, ou no próprio post, a pessoa **aceita** (o post entra no perfil e no feed dela e a marcação fica pública) ou **recusa**; quem aceitou pode tirar a marcação depois. Posts de autor que o visitante não pode ver não aparecem no perfil do marcado.
- Onde aparecem: aba **Posts** no perfil (grade de quadrados; o selo marca carrossel), **Home** (posts seus, dos amigos e aqueles em que você aceitou a marcação) e a página do post `/posts/:id`. Perfil privado só mostra posts a quem segue; bloqueio esconde nos dois sentidos. Só o autor apaga.
- Rotas: `POST /posts`, `GET /posts/feed`, `GET /posts/pending-tags`, `GET/DELETE /posts/:id`, `POST /posts/:id/tag` (`{action: 'accept'|'decline'}`), `GET /profiles/:usuario/posts`, `GET /posts/images/:id` (pública, como a foto de perfil; o id é aleatório).
- Limites honestos: **o navegador não deixa um site listar a galeria do celular sozinho** (só pelo seletor do sistema); a galeria aberta direto no app, como no Instagram, só vem com o app nativo (Capacitor). O corpo JSON da API passou de 100 KB para 1 MB (cada foto chega em base64). Fotos no banco, sem armazenamento de arquivos nem moderação. A referência da foto do Google pode expirar (a foto então aparece como "indisponível"). Não há curtir, comentar, editar post nem reordenar fotos ainda. O Postgres só é exercitado na sua máquina (`AskouT.command` aplica as migrações `20261017120000_posts` e `20261018120000_post_tags` e o `009_post_constraints.sql`).

### Mensagens de voz

- Na conversa (1 a 1 e grupo), com o campo vazio o botão redondo é um **microfone**. Tocar nele grava: a barra mostra X (cancelar), o tempo e a seta (enviar). Ao digitar qualquer caractere o microfone vira a seta de texto.
- Limites: **1 a 90 segundos** e até 600 KB (gravação a ~32 kbps, ~360 KB em 90 s). Ao chegar em 90 s a gravação para e é enviada.
- O balão tem play/pausa, barra de progresso e duração; só um áudio toca por vez. O áudio só é baixado quando alguém toca nele, com o token da pessoa: `GET /conversations/:id/messages/:messageId/audio` responde 404 para quem não está na conversa e 401 sem login.
- Formatos (o que cada navegador grava): webm/opus (Chrome), mp4 (Safari), ogg/opus (Firefox). A API confere os primeiros bytes do arquivo, não só o tipo declarado.
- Banco: migração `20261021120000_voice_messages` (`Message.audioMs` e tabela `MessageAudio`) e `prisma/sql/010_voice_constraints.sql`; o `AskouT.command` aplica sozinho.
- Limites honestos: **o navegador só libera o microfone em https** (ou localhost) e pede permissão; o áudio fica no banco (sem armazenamento de arquivos, sem transcrição nem moderação); sem pré-escuta antes de enviar, sem onda sonora; a gravação testada aqui usa um microfone de teste do Chromium. **Ainda não foi ouvido num celular real**, e o repositório Prisma/Postgres só roda na sua máquina.

### Duração do Flash em roleta

- Ao ligar o Flash, a duração se escolhe numa **roleta de horas e minutos** (estilo relógio do iPhone): de 5 min a 3 h, de 5 em 5 minutos, com o horário em que termina logo abaixo.
- A API aceita `minutes` (múltiplo de 5, 5–180) em `POST /me/flash`; `hours` (1, 2 ou 3) continua valendo por compatibilidade.
- Verificado em navegador de celular simulado (rolagem e teclado); o toque real no celular ainda não foi testado.

### Menu ⋯ e ações do post

- Todo post tem, embaixo, **Curtir, Comentar e Compartilhar**. Curtidas e comentários avisam o autor (sino).
- Menu ⋯ em post de outra pessoa: **Denunciar** (motivo + detalhes, guardado em `PostReport` para o futuro painel admin) e **Não tenho interesse** (o post some só do seu feed).
- Menu ⋯ no seu post: **Excluir, Editar** (legenda, lugar, evento), **Ajustar** (`<>`, recorta de novo a foto enviada; a foto ganha endereço novo para não aparecer a versão antiga em cache) e **Arquivar** (some do feed e do perfil; fica em `/arquivados`, menu do perfil).
- Compartilhar envia o link do post por conversa ou pelo compartilhamento nativo do aparelho (sem cartão rico no chat).
- Migração `20261020120000_post_engagement` + acréscimos em `prisma/sql/009_post_constraints.sql`; o `AskouT.command` aplica sozinho.
- Limites: só testado em memória aqui; a versão Postgres/Prisma e o `smoke.mjs` rodam no seu Mac; arrastar o recorte no celular real ainda não foi testado; denúncias só são guardadas (sem tela de análise ainda).

## App web (`apps/web`)

React 19 + Vite 7 + TypeScript. Telas: entrar, criar conta (2 passos com código por e-mail), Home (amigos), Explorar (busca), Atividades (pedidos para seguir), perfil de outras pessoas (seguir, pedir, deixar de seguir, bloquear), Meu perfil (editar, privacidade), Amigos, Bloqueados. Agenda (faixa de 28 dias, folha "Marcar horário", agenda do amigo) e "Encontrar melhor data" (escolher amigos, período, duração e horário de início). Flash (raio no topo e botão grande na Home): ligar por 1/2/3 h, mapa na tela do Flash com você e os amigos que aceitaram sair com você, livres agora, convidar, aceitar/recusar, encontro com mapa, distância e bloquear. Conversas: lista com não lidas e chat 1 a 1 entre amigos; ao aceitar um convite do Flash a conversa abre, com o botão "Sugerir um lugar" (mini carrossel de eventos e lugares perto do ponto médio entre os dois).

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
- **Flash:** a posição só é enviada com a tela do encontro aberta (navegador não envia em segundo plano; o app nativo resolve isso depois). Convites e posições são atualizados por consulta a cada 8–10 s, não por conexão em tempo real. Não há aviso quando alguém te convida fora do app.
- **Conversas:** as mensagens chegam por consulta a cada 5 s (não em tempo real), sem aviso fora do app, sem anexos, sem editar/apagar, sem marcar "digitando". Mensagens ficam guardadas em texto puro no banco (sem criptografia de ponta a ponta); denúncia e moderação ainda não existem.
- **Explorar:** ainda não existe cadastro real de eventos (virá com o painel do local); até lá só aparecem os de exemplo e os lugares do Google/OpenStreetMap. Hashtags existem só em eventos (não há posts). A busca olha até 500 eventos pré-filtrados por período/raio/tipo; a ordem é por horário. Sem ordenação escolhida pelo usuário e sem paginação.
- `total` nas listas de seguidores pode incluir pessoas ocultas por bloqueio de terceiros.

## Próximos passos

1. Escolher o provedor de e-mail e implementar o envio real; limite por IP e Helmet (hoje só o cadastro tem limites, no núcleo).
2. Front end web: cadastro, login, perfil, seguir e bloquear consumindo estas rotas.
3. Limite de tentativas, verificação de e-mail, recuperação de senha, refresh token.
4. Fase 2 (em andamento): agenda manual e comparação **feitas**; Flash feito e validado no celular; conversas 1 a 1 e sugestões de lugares feitas (a validar na sua máquina); faltam encontros e convites a partir do melhor horário, repetição semanal, grupos e o cadastro real de eventos pelo painel do local.
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
