# Pendências para o go live

Itens que ficaram de fora de propósito até a publicação. Marque com `[x]` quando concluir.

## Entrar com Google e Apple
O código está pronto e desligado: sem os IDs abaixo, os botões não aparecem. Faltam só as chaves, que dependem do domínio definitivo.
- [ ] Definir o domínio do site (HTTPS).
- [ ] Google: criar o ID de cliente "Aplicativo da Web" no Google Cloud e cadastrar o endereço do site em "Origens JavaScript autorizadas". Pôr em `GOOGLE_CLIENT_ID` (o Google pode ser ativado antes do go live: é grátis).
- [ ] Apple: assinar a conta de desenvolvedor, criar o "Services ID" e cadastrar o domínio e a URL de retorno. Pôr em `APPLE_CLIENT_ID`. Não funciona em localhost.
- [ ] Rodar `npx prisma migrate deploy` no servidor e reiniciar a API.
- [ ] Testar uma entrada com cada plataforma: conta nova, conta com o mesmo e-mail já existente e entrada repetida.
- [ ] No app nativo (Capacitor), oferecer os dois juntos: a Apple exige "Entrar com a Apple" quando há outro login social.
- [ ] Decidir se quem entrou por Google/Apple pode definir uma senha depois (hoje não pode).
- [ ] Outras plataformas (Microsoft, Facebook), se quiser.

## Sincronizar agendas (celular, Google, Outlook)
A tela de escolha existe, mas nada é importado ainda e a escolha fica salva só no aparelho.
- [ ] Ligação real com Google Agenda e Outlook (precisa de chaves OAuth).
- [ ] Ligação com a agenda do celular (precisa do app nativo).
- [ ] Mover a escolha de agendas ligadas para a conta, no servidor.

## Outros itens já combinados
- [ ] Provedor de e-mail real (hoje o código de cadastro só sai no terminal; produção recusa esse modo).
- [ ] Idade mínima e LGPD (consentimento e política).
- [ ] Limite de requisições (rate limit) na API.
- [ ] Capacitor / app nativo (iOS e Android).
- [ ] Verificação do telefone por código.
- [ ] Chave do Google Places (sem cartão cadastrado por enquanto; o app usa só OpenStreetMap).
- [ ] Avisos de novos seguidores.
- [ ] Votação de datas, fase 2.
- [ ] Vídeo nos posts: hoje o vídeo (até 60 MB) fica no próprio Postgres e é servido pela API. Para valer em escala, mover para armazenamento de arquivos (com CDN) e comprimir/gerar versões leves no servidor.
- [ ] Vídeo nos posts: a duração máxima (3 minutos) é conferida só no app; conferir também no servidor. Testar em iPhone/Android de verdade.

## Stories de evento

- [ ] Fotos e vídeos dos stories ficam dentro do Postgres (até 60 MB cada, 10 por pessoa por evento). Antes de ter muita gente, mover para armazenamento de arquivos (S3/R2) com expiração automática.
- [ ] Story expirado só some da tela: a linha continua no banco até o evento ser apagado. Criar uma tarefa que apague os vencidos.
- [ ] Duração do vídeo (até 3 minutos) só é conferida no app, como nos posts.
- [ ] Denúncias de story já aparecem no painel da gestão (Denúncias > Stories), com a foto/vídeo para conferir, e a gestão pode apagar o story. Falta decidir se o story deve sair do ar para todos depois de N denúncias.
- [ ] Sem lista de quem viu e sem aviso (notificação) quando alguém posta story.

## Lembrete de evento (push 30 min antes)
- Job `EventReminders` roda a cada minuto dentro da API (sem fila externa). Se rodar mais de uma instância, o marcador `EventReminder` evita aviso em dobro; o pior caso é não avisar.
- Migration `20261115120000_event_reminders` precisa rodar no banco.
- Push real exige as chaves VAPID configuradas e o aparelho com "Avisos no aparelho" ligado.

## Recuperar senha
- Hoje o código vai por e-mail. Em produção falta o provedor real de e-mail (hoje `ConsoleEmailSender` só imprime no log, igual ao cadastro).
- Migration `20261116120000_password_reset` precisa rodar no banco.
- Por celular (SMS): a tabela já tem `channel`; falta guardar o número verificado na conta (item "verificação de telefone") e um provedor de SMS.
- As sessões já abertas (token) continuam valendo depois da troca de senha; só dá para derrubá-las com revogação de token, ainda não existe.
- Falta limite por IP nas rotas públicas (item "rate limit"): o limite atual é por conta (1 código/min, 5 por pedido, 5 tentativas).

## Onboarding, navegação e suporte
- Suporte por e-mail: defina `VITE_SUPPORT_EMAIL` no build da web com uma caixa real. Sem isso, a Ajuda mostra "ainda não foi ativado".
- O onboarding usa `localStorage` (por usuário): aparece uma vez por navegador. Antes do lançamento, decidir se vale guardar no servidor.
- O passo "siga 3 bares" usa a busca do Explorar sem localização; com lugares do Google/OSM é preciso a chave da API de lugares configurada, senão a lista pode vir vazia (o passo tem "Pular").

## Posicionamento: rede social de rolês (bares e baladas)
- Lançamento: **uma cidade e dois temas** (Bares e Baladas). Novos temas (cinema, parques…) entram em `apps/web/src/lib/themes.ts` (lista `THEMES`), sem mexer no resto.
- Antes de abrir: cadastrar/semear rolês e eventos reais dessa cidade (hoje só há dados "[TESTE]"). Home vazia é o maior risco do lançamento.
- Baladas dependem das fontes de fora: o Google passou a incluir `night_club` e o OpenStreetMap `nightclub`. Isso só vale com a chave do Google ativa; não foi testado contra as APIs reais.
- O tema de cada rolê é deduzido pelo tipo (texto livre do dono ou tipo do Google/OSM). Pedir ao dono para preencher "Tipo de rolê" melhora o filtro. Eventos sem tipo caem em Bares.
- O endereço das páginas continua `/bares/...` (para não quebrar links); trocar só se for preciso.

## Convite, amigos no rolê e aviso do Flash
- Convite: o link é `/cadastro?convite=<usuario>` (sem token). Quem se cadastra pelo link passa a seguir o convidante no onboarding; só vira amigo se o convidante seguir de volta. Se o convidante tiver perfil privado, vira pedido pendente. Não há recompensa nem contagem de convites.
- "Amigos que já foram": usa as presenças confirmadas em eventos que já começaram (mesma base do ranking). Não aparece no card de evento do Explorar, só na página do rolê.
- Aviso do Flash: aparece uma vez por navegador, antes da primeira ativação. Se a regra de visibilidade ou de localização do Flash mudar, atualizar `FLASH_PRIVACY_POINTS` em `lib/hints.ts` e a política de privacidade.

## Buscas recentes (Explorar)
- As buscas recentes ficam só no navegador da pessoa (até 8, por usuário), com botão de apagar uma ou todas. Não vão para o servidor. Citar isso na política de privacidade.
- Uma busca entra nas recentes ao apertar Enter, ao tocar numa sugestão ou depois de achar resultados e ficar 1,5 s na tela.

## Impulsionamento (anúncios pagos pelos donos)
- **Pagamento DESLIGADO por padrão.** A chave `PAYMENTS_ENABLED` (padrão `false`) bloqueia qualquer pedido novo: a tela mostra "Impulsionar chega em breve" e a API responde 409. Anúncios já pagos continuam no ar, e avisos de pagamento e compras de loja que já estavam a caminho ainda são confirmados. **Para ligar em produção:** `PAYMENTS_ENABLED=true` + provedor configurado (a API recusa subir com a chave ligada sem provedor). Fora de produção, `PAYMENTS_ENABLED=true` com o pagamento de teste já basta para experimentar (botão "Simular pagamento").
- **Web (Pix e cartão): Stripe Checkout** (`infra/payments/stripe-payment-gateway.ts`). Variáveis: `PAYMENT_PROVIDER=stripe`, `STRIPE_SECRET_KEY` (sk_live_… em produção; chave de teste é recusada), `STRIPE_WEBHOOK_SECRET` (whsec_…), `PUBLIC_WEB_URL` (https, sem barra no fim). O AskouT nunca vê cartão: a pessoa paga na página da Stripe e volta para `/bares/ID/impulsionar?pagamento=ok`. O aviso (`POST /payments/webhook`) tem a assinatura conferida (HMAC-SHA256, tolerância de 5 min, comparação em tempo constante), só libera com `payment_status=paid` em reais **e valor igual ao do pedido**, e é idempotente. **Escrito pela documentação da Stripe e testado só com simulações: nunca falou com uma conta real.** Antes de abrir: criar a conta (CNPJ), ativar Pix, cadastrar o endpoint do webhook (eventos `checkout.session.completed`, `checkout.session.async_payment_succeeded` e `checkout.session.async_payment_failed`) e fazer uma compra de teste ponta a ponta com a chave `sk_test_` e outra real de valor mínimo.
- **Lojas (iOS/Android): compra dentro do app, obrigatória para bens digitais** (confirmar nas diretrizes vigentes da Apple 3.1.1 e do Google Play; a comissão é de 15% a 30%). O fluxo está pronto no servidor: o pedido é criado com `channel` APPLE/GOOGLE (sem cobrança no provedor), o app compra o produto `askout.boost.{1,3,7,14}d` (consumível) e envia o recibo para `POST /me/boosts/:id/store-purchase`; o servidor só libera depois de conferir na loja, recusa recibo de outro produto, devolvido ou já usado em outro pedido, e é idempotente. Preço da loja: `BOOST_STORE_PRICE_PER_DAY_CENTS` (padrão = preço da web), que precisa bater com a tabela de preços cadastrada na loja.
  - **Falta (nada disso existe ainda):** (1) o **verificador real** (`StorePurchaseVerifier` em `core/ports.ts`; hoje não há implementação, então `pricing.store.available` é `false` e a API recusa pedidos de loja): Apple, App Store Server API (consultar a transação, conferir bundle id, produto e `revocationDate`); Google, Play Developer API (`purchases.products.get`, conferir pacote e produto, **reconhecer/consumir a compra em até 3 dias**, senão o Google devolve o dinheiro); (2) a **casca nativa** (Capacitor) com o objeto `window.AskouTStore.purchase(produtoId)` que devolve o recibo (contrato em `apps/web/src/lib/purchase.ts`); (3) cadastrar os 4 produtos nas duas lojas e as contas de desenvolvedor; (4) **notificações de reembolso** das lojas (App Store Server Notifications V2 e Google RTDN) para encerrar o anúncio quando a loja devolver o valor. Reembolso na web (Stripe) também não retira o anúncio hoje.
  - Se a Apple/Google classificarem o impulsionamento como serviço consumido fora do app, a compra por Pix/cartão no app poderia ser permitida; **isso é decisão de revisão da loja e jurídica, não técnica. Não assumir.**
- Preço: R$ 15,00 por dia (`BOOST_PRICE_PER_DAY_CENTS`, de 100 a 1.000.000); pacotes de 1, 3, 7 ou 14 dias. O anúncio começa na confirmação do pagamento.
- Só o responsável pelo local cria. Um pedido em aberto por alvo (rolê ou evento). Cancelar só antes do pagamento; **não há reembolso nem cancelamento depois de pago**, nem métricas (alcance, cliques) e nem tela de admin para pausar (o estado PAUSED existe no banco).
- Onde aparece: primeiro nos resultados do Explorar (fora do filtro "Bombando") e até 2 eventos na Home ("Rolês em destaque"), com rodízio por hora. Sempre com a etiqueta "Patrocinado" (exigência de transparência publicitária; revisar com advogado, CONAR/CDC).
- Antes de cobrar de verdade: termos de uso do anunciante, política de reembolso, emissão de nota fiscal e CNPJ/regime da empresa. Nada disso está feito.
- Migrações `20261117120000_boosts` e `20261202120000_boost_channel` escritas à mão e **nunca rodadas em Postgres**; rodar `prisma migrate deploy` + `prisma generate` e testar o `PrismaBoostRepository` (inclui o contrato do recibo único por pedido) antes de publicar.

## Motor de recomendação da Home ("Para você")
- **O que faz:** bloco no meio da Home (depois do 2º post) com eventos a que seus amigos vão e posts que eles curtiram/comentaram, pesados por **proximidade** (conversas 1 a 1, curtidas, comentários e tempo olhando os posts de cada amigo; interação recente pesa mais, meia-vida de 14 dias). Também sugere eventos **parecidos com o que te prendeu** (mesma hashtag, tipo, local, autor ou categoria). Rota `GET /me/recommendations`; código em `core/recommendation-service.ts`.
- **"Prendeu":** o conteúdo fica na tela (≥60% visível, aba aberta) mais que a **média da própria pessoa**, com piso de 3 s e teto de 120 s por medição. Com menos de 8 medições, vale só o piso. O app manda as medições em lote (`POST /me/dwell`) a cada 15 s ou ao sair da aba.
- **Não repete:** posts já vistos (>1,5 s), já curtidos/comentados, eventos a que a pessoa já vai, e evento mostrado 3 vezes no bloco sem clique. No máximo 2 itens do mesmo local/autor. Posts só entram se a pessoa pode vê-los (perfil privado, evento privado, bloqueio).
- **Privacidade (LGPD):** medir tempo na tela é dado de comportamento. Ligado por padrão, com chave em Privacidade ("Recomendações personalizadas"); desligar para de medir, apaga o histórico e passa a usar só o que os amigos fizeram. Há também "Apagar meu histórico". Guardamos 60 dias (apagado a cada envio). A resposta nunca diz quem curtiu o quê; só mostra quem **vai** a um evento (a lista de presença já é pública). **Antes do lançamento:** colocar na política de privacidade e nos termos o uso do comportamento para recomendar e decidir com advogado se o padrão pode ser "ligado" ou se precisa de consentimento prévio.
- **Gosto a partir de gestos:** curtir (peso 1,5), comentar (2) e compartilhar (2,5) pesam mais que o tempo na tela (1 a 2) na hora de aprender o gosto; o que a pessoa compartilhou, curtiu ou comentou não volta no bloco. Compartilhar conta quando a pessoa envia numa conversa, compartilha/copia o link para fora do app ou posta o evento no próprio perfil; fica gravado com a medição (`shared`). Só vale com a personalização ligada. Compartilhar um local ou perfil não entra (só posts e eventos).
- **Confirmar presença:** entra no gosto com peso 2,5 (igual a compartilhar), para eventos de local e de pessoas, e o evento a que a pessoa já vai não volta.
- **Gosto dos amigos próximos:** as curtidas, comentários e presenças confirmadas dos 10 amigos mais próximos (pela mesma conta de proximidade) também alimentam o gosto de quem vê, com peso = peso do gesto x proximidade (0,1 a 1) x 0,6. Um amigo no máximo de proximidade vale 60% do mesmo gesto feito pela própria pessoa. Só entra post que a pessoa pode ver (perfil privado e evento privado ficam de fora). Não usa o tempo na tela, os compartilhamentos nem as mensagens dos amigos. **Para o jurídico:** isso usa ações de uma pessoa para influenciar o que outra vê, sem avisar quem agiu; a política de privacidade precisa dizer isso. Constantes em `core/recommendation-service.ts` (`RECO_FRIEND_TASTE_FACTOR`, `RECO_TASTE_FRIENDS`).
- **Mensagens diretas:** entram na proximidade (só quando e com quem, nunca o texto; conversas 1 a 1, sem apagadas nem do sistema; log por dia, quem manda pesa mais que quem recebe). Valem só com a personalização ligada. A consulta lê até 3.000 mensagens dos últimos 60 dias de uma pessoa (`directActivity`); se o chat crescer muito, trocar por contagem agregada no banco.
- **Painel de retenção:** no app de admin, página "Retenção" (`GET /admin/retention?days=`). Compara o bloco "Para você" com o feed (exibições, pessoas, tempo médio, aberturas e taxa de abertura) e mostra, para dias com atividade, quem voltou 1 e 7 dias depois (separando quem viu o bloco naquele dia de quem não viu), mais a série dia a dia. Cada abertura (toque num link do post ou evento) é gravada junto da medição (`clicked`), tanto no bloco quanto no feed (Home, Explorar e posts de um local). Antes do commit que ligou isso no feed, só o bloco gravava; esses dias não servem para comparar. Lê até 200.000 medições por consulta e avisa se cortou.
- **Como ler o painel:** "atividade" = ter tempo medido naquele dia, então quem desligou as recomendações some dos números (subestima o uso). Quem viu o bloco e voltou mais **não prova** que o bloco causou isso (quem usa mais vê mais o bloco). Para provar, esconder o bloco de um grupo sorteado e comparar: ainda não existe. Com menos de 30 dias-pessoa num grupo o painel avisa "poucos dados".
- **Limites:** os pesos (`RECO_WEIGHTS` e afins) são palpites e precisam de ajuste com uso real; só recomenda eventos do AskouT, não lugares do Google/OSM.
- Migração `20261120120000_content_dwell` escrita à mão e **nunca rodada em Postgres** (`prisma migrate deploy` + `prisma generate`; depois rodar a suíte de contrato Prisma, que já cobre `ContentDwell` (inclui `clicked` e `listAllSince`), `listEngagement` e `directActivity`).

## Match (impulsionamento por gosto e raio)

O dono escolhe um evento, o raio (2, 5, 10 ou 25 km em volta do local) e de 1 a 5 hashtags do próprio evento (ex.: #rock). O anúncio só aparece, com a etiqueta "Patrocinado" e o motivo ("Combina com você: #rock · a cerca de 3 km"), no bloco "Para você" de quem **tem região salva dentro do raio** e **tem o gosto validado** por uma das hashtags. No máximo 1 anúncio Match por vez, em segundo lugar na lista. Não aparece no destaque geral do Explorar.

**Regra do gosto validado** (`core/match.ts`, constantes no topo, fáceis de ajustar). Olhando só para o que a própria pessoa fez nos últimos 60 dias (curtir, comentar, compartilhar, confirmar presença, ficar mais tempo que a própria média): pelo menos 3 conteúdos diferentes com a hashtag, em pelo menos 2 dias diferentes, peso somado de pelo menos 4 (envelhece: metade a cada 30 dias) e o último gesto nos últimos 30 dias. Só as 5 hashtags mais fortes de cada pessoa valem. O gosto dos amigos não entra. Os números (3, 2, 4, 30 dias, 5) são palpites e precisam ser calibrados com uso real.

**Região do usuário** ("Minha região", em Privacidade): opcional, a pessoa toca em "Usar minha localização atual", o app usa a localização uma vez e o servidor guarda a coordenada arredondada (~1 km). Dá para apagar; some junto com a conta; desligar as recomendações personalizadas também apaga a região. Sem região, a pessoa não entra em nenhum Match.

**Privacidade do alcance:** o dono vê só uma faixa ("menos de 10 pessoas" ou "cerca de N pessoas", arredondado para baixo de 10 em 10), nunca quem. Nada identifica pessoas.

**Antes de ir ao ar:**
- Rodar a migração `20261125120000_match` (nunca foi executada contra um Postgres; escrita à mão). O repositório Prisma de região e as colunas novas do Boost só foram testados em memória.
- **Advogado:** localização é dado pessoal. Hoje o consentimento é o ato de tocar em "Usar minha localização atual", com o texto explicando o uso. Confirmar se basta, o texto exato, e o uso para publicidade segmentada (comentar também na política de privacidade e nos termos para donos).
- **Preço:** o Match custa o mesmo por dia que o destaque comum (`BOOST_DEFAULT_PRICE_PER_DAY_CENTS`). Definir se terá valor próprio.
- **Limites conhecidos:** a estimativa examina no máximo 1000 pessoas da região por consulta (a tela avisa quando é parcial) e calcula o gosto na hora, o que não escala; com muitos usuários, calcular os gostos em lote (ex.: de madrugada) e guardar. O dono pode variar raio e hashtags para tentar isolar pessoas; a faixa mínima de 10 e o arredondamento reduzem isso, mas vale limitar o número de consultas por dono.
- Não há ainda relatório para o dono (quantas vezes o anúncio foi exibido e aberto) nem cobrança diferente por resultado. A exibição já é medida como as demais do "Para você" (fonte RECO).
- O Match só existe no "Para você" da Home; não aparece no Explorar nem fora do app.

## Link de ingresso nos eventos dos locais

- Rodar a migração `20261201120000_event_ticket_url` (coluna `PlaceEvent.ticketUrl`). O `npm run update` do ambiente de teste já faz isso.
- O AskouT só leva a pessoa até o site de venda (botão "Comprar ingresso" na página do evento, com o nome do site embaixo). Não vende, não cobra e não entrega ingresso: o texto da tela diz isso. Revisar o texto com o jurídico (responsabilidade por link de terceiros, Código de Defesa do Consumidor).
- Regras do link: só `https://`, até 500 caracteres, com domínio (sem IP, `localhost`, `.local`, `.internal` nem usuário/senha no endereço). O botão abre em outra aba com `noopener noreferrer nofollow sponsored`.
- Falta decidir: denunciar link suspeito (golpe de ingresso falso) e o painel de gestão poder remover o link; contar cliques para o dono do local ver quantas pessoas foram ao site de venda.
- Só eventos de locais (`PlaceEvent`). Eventos criados por pessoas (posts de evento) ainda não têm link de ingresso.
