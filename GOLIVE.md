# Pendências para o go live

Itens que ficaram de fora de propósito até a publicação. Marque com `[x]` quando concluir.

## ⚠️ Antes de subir nas lojas: LIMPAR TUDO QUE É DE TESTE (pedido do Sylvio, 23/10/2026)
Quando chegar a hora de publicar nas lojas (Apple e Google), o Claude deve fazer uma limpa em tudo o que foi cadastrado só para teste no app e no banco de produção. Fazer **depois de um backup do banco** (`pg_dump`, ou o backup do Render/Railway) e **mostrando a lista do que vai sair ao Sylvio antes de apagar**. Não apagar a conta de administrador nem os dados reais.

Checklist:
- [ ] **Pessoas e posts de exemplo `[TESTE]`**: `npm run seed:demo -- --clear` (contas `teste_*`, e-mail `@teste.askout.invalid`). Atenção: o script **recusa rodar com `NODE_ENV=production`**; para limpar o banco de produção, rodar de uma máquina com `DATABASE_URL` de produção e sem `NODE_ENV=production`, conferindo o banco de destino antes (ou apagar pelo painel de gestão).
- [ ] **Lugares e eventos de exemplo** (selo "Exemplo de teste", `isSample`): `npm run seed:places -- --clear`.
- [ ] **Contas de teste de pessoas reais** (as do Sylvio e de quem testou, inclusive as criadas pelo `smoke.mjs` e pelos testes no celular): listar no painel de gestão ou no banco, escolher quais ficam (as do Sylvio e do administrador) e apagar o resto pelo fluxo de "apagar conta" (apaga em cascata).
- [ ] **Conteúdo criado nos testes**: posts, comentários, stories, posts de evento, conversas, grupos, votações de data, encontros, Flash, notificações, denúncias e registros de auditoria de teste. Em geral saem junto com as contas; conferir o que sobra (denúncias e auditoria não somem sozinhas).
- [ ] **Locais reivindicados de teste** (pedidos de posse de bar) e donos de teste: desfazer; conferir o painel de claims.
- [ ] **Impulsionamentos de teste**: apagar. Pagamentos desligados até depois do lançamento; se houve compra de teste (sandbox Apple, testadores do Google Play, Stripe em modo teste), não deixar registro misturado com os reais.
- [ ] **Inscrições de push e dispositivos de teste**: remover as inscrições antigas.
- [ ] **Usuários de teste do Google** (tela de consentimento) e testadores das lojas: o app já está "Em produção", conferir que não sobrou lista de teste.
- [ ] **Textos "[TESTE]" ou de rascunho visíveis no app**: procurar no código e no app por "[TESTE]", "Exemplo de teste", "versão preliminar" (`LEGAL_REVIEWED` precisa estar `true` só depois da revisão do advogado) e placeholders "[A revisar]".
- [ ] **Chaves de teste**: nenhuma chave de teste (Stripe `sk_test`, Resend de teste etc.) nas variáveis de produção.
- [ ] Depois da limpa: contar usuários, posts e lugares (o painel de gestão mostra os totais) e conferir que o primeiro acesso não cai em tela vazia sem querer (os exemplos `[TESTE]` existem justamente para isso; decidir se algum conteúdo inicial real entra no lugar).

## Entrar com Google e Apple
O código está pronto e desligado: sem os IDs abaixo, os botões não aparecem. Faltam só as chaves, que dependem do domínio definitivo.
- [ ] Domínio: `askout.com.br` (Hostinger; ativo desde 22/10/2026, ainda sem registros). Implantação passo a passo em `deploy/README.md` (Cloudflare + Railway + Resend); Dockerfile da API e rota `/saude` já existem, mas a imagem nunca foi construída nem rodada. Plano de endereços: `askout.com.br` (site), `api.askout.com.br` (API), `gestao.askout.com.br` (portal de gestão). Em produção: `PUBLIC_WEB_URL=https://askout.com.br`, `CORS_ORIGINS=https://askout.com.br,https://gestao.askout.com.br,https://localhost,capacitor://localhost`, `VITE_API_URL=https://api.askout.com.br`.
- [x] (feito em 23/10/2026, ver seção "Google Login") Google: criar o ID de cliente "Aplicativo da Web" no Google Cloud e cadastrar o endereço do site em "Origens JavaScript autorizadas". Pôr em `GOOGLE_CLIENT_ID` (o Google pode ser ativado antes do go live: é grátis).
- [x] Apple (feito em 24/10/2026, na equipe PESSOAL "Sylvio Luiz", team 359NDWACC5; a equipe Thunderbolt LTDA está com a assinatura vencida e não é usada): App ID `br.com.askout` (Entrar com a Apple + compras), Services ID `br.com.askout.web` (domínio askout.com.br, retorno https://askout.com.br), `APPLE_CLIENT_ID=br.com.askout.web` posto no Render. App criado no App Store Connect como "AskouT Encontros" (o nome "AskouT" já é usado por um app antigo da Thunderbolt; ver se dá para liberar). **Falta testar o login Apple na web.** Feito também (24/10): subtítulo "Bares, eventos e amigos", categoria Social Networking (secundária Lifestyle) e classificação etária (respondida: conteúdo de usuários, rede social, mensagens, publicidade/impulsionamento; bebida alcoólica frequente; resultado 18+ na maioria dos países e 16 no Brasil). Também feitos (24/10): direitos de conteúdo (sim, com direitos) e App Privacy publicado (12 tipos de dado, todos para funcionamento do app, vinculados à conta, sem rastreamento; política https://askout.com.br/politica-de-privacidade; ajustar na política a frase de localização, pois o Flash guarda posição exata durante o encontro). O nome do app no App Store Connect aparece como "AskouT app" (conferir). Também (24/10): DSA = "não sou trader / não distribuo na UE" (Active); banco (Nubank) em processamento; formulário fiscal brasileiro ativo, **falta o W-8BEN (Add Tax Form)** para o Contrato de Apps Pagos sair de "Pending User Info". Os 4 produtos consumíveis `askout.boost.{1,3,7,14}d` foram CRIADOS como rascunho no App Store Connect, **sem preço, sem nome/descrição de exibição, sem disponibilidade e sem captura de tela de revisão**. Preço: a Apple só aceita faixas fixas (o app cobra R$ 15/dia = 15/45/105/210); escolher as faixas mais próximas e conferir se o valor mostrado no app bate com a loja. O primeiro produto precisa ser enviado junto com uma versão do app. Concluído: W-8BEN, Paid Apps Agreement, banco e impostos ativos; 4 produtos askout.boost.* com nome/descrição pt-BR, preço com desconto progressivo (base Brasil: 1d R$14,90, 3d R$34,90, 7d R$69,90, 14d R$129,90 — faixas fixas da Apple; a mesma tabela está em `BOOST_DEFAULT_PACKAGE_PRICES_CENTS`, no servidor, e vale na web também) e disponibilidade em 175 países. Build iOS 1.0 (1) arquivado no Xcode do MacBook do Sylvio (time pessoal, assinatura automática, capacidade Sign In with Apple) e ENVIADO ao App Store Connect em 24/10/2026 (o Mac foi registrado como dispositivo na conta, exigência do Xcode sem iPhone; simuladores do Xcode não foram baixados). Falta: esperar o processamento do build, preencher a ficha do app (descrição, palavras-chave, URLs, capturas 6,9"/6,5", conta de demonstração e notas de revisão), anexar o build e os 4 produtos (captura de tela de revisão de cada um), conformidade de exportação (só HTTPS) e enviar para revisão. Não testado em aparelho: login Apple nativo, compra Sandbox, verificador StoreKit 2.
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
- [ ] E-mail real: o envio pelo Resend está escrito e testado com respostas simuladas, mas NUNCA rodou contra a conta real. Falta: criar a conta no Resend, adicionar o domínio e publicar no DNS os registros que ele mostrar (SPF e DKIM; DMARC recomendado), gerar a chave, e na API de produção definir `EMAIL_TRANSPORT=resend`, `RESEND_API_KEY` e `EMAIL_FROM`. Depois, testar cadastro e recuperação de senha com um e-mail seu (e conferir se não cai no spam no Gmail, Outlook e iCloud).
- [ ] Idade mínima e LGPD (consentimento e política).
- [ ] Limite de requisições (rate limit) na API.
- [ ] Capacitor / app nativo (iOS e Android).
- [ ] Verificação do telefone por código.
- [ ] Chave do Google Places (sem cartão cadastrado por enquanto; o app usa só OpenStreetMap).
- [ ] Avisos de novos seguidores.
- [ ] Votação de datas, fase 2.
- [ ] Vídeo nos posts: hoje o vídeo (até 60 MB) fica no próprio Postgres e é servido pela API. Para valer em escala, mover para armazenamento de arquivos (com CDN) e comprimir/gerar versões leves no servidor.
- [ ] Vídeo nos posts: a duração máxima (3 minutos) é conferida só no app; conferir também no servidor. Testar em iPhone/Android de verdade.
- [ ] Vídeo nos posts: o servidor entrega o vídeo inteiro do banco a cada pedido de trecho (Range), o que pesa com muita gente. Resolvido junto com a mudança para armazenamento de arquivos (S3/R2 + CDN).

## Aplicativo nativo (casca Capacitor, `apps/mobile`)
Feito: pacote `apps/mobile` com as pastas `android/` e `ios/` geradas, o app web empacotado em `www/` e as duas pontes nativas (`window.AskouTVideo` com `capacitor-native-video-compressor`, e `window.AskouTStore` com `@capgo/native-purchases`), com testes. Permissões de galeria, câmera, microfone e localização já declaradas; JitPack já no Gradle. NADA disso foi compilado ou aberto num aparelho: o sandbox não tem Android SDK nem Xcode.

**Feito em 24/10/2026 (testado só com dados de teste): API aceita o bundle id no login Apple e confere a transação StoreKit 2 (`infra/store/apple-purchase-verifier.ts`); ligam com `APPLE_APP_ID=br.com.askout` no Render. Falta: plugin de login Apple nativo no app, conferência do Google Play, e uma compra Sandbox real.

**Roteiro completo para iPhone (Xcode, assinatura, TestFlight): `apps/mobile/IOS.md`.**

Como gerar (no seu Mac, com Android Studio e Xcode instalados):
1. `cd apps/mobile && VITE_API_URL=https://api.seudominio.com.br npm run sync` (gera `www/` e copia para as duas plataformas).
2. `npx cap open android` / `npx cap open ios` e rodar num aparelho ou emulador.

- [ ] Confirmar o `appId` (`br.com.askout` (decidido em 24/10/2026), em `apps/mobile/capacitor.config.ts`): vale também para a Apple e o Google e NÃO muda depois de publicar.
- [ ] Na API de produção, incluir `https://localhost,capacitor://localhost` em `CORS_ORIGINS` (o app roda nessas origens). A API precisa estar em https.
- [ ] Primeira compilação em Android Studio e Xcode (assinatura e versão; ícones e tela de abertura já vêm do logo, gerados por `apps/mobile/scripts/make-icons.py`, mas ainda não foram vistos num aparelho). Xcode: ativar a capacidade "In-App Purchase".
- [ ] Testar as pontes em aparelho: compressão (iPhone e Android), compra de teste (sandbox da Apple e testadores do Google Play), e se `fetch` do arquivo comprimido funciona no WebView.
- [ ] Cadastrar o produto de compra única "impulsionamento por dia" nas duas lojas com o mesmo identificador usado pelo servidor.
- [x] Push nativo no iPhone (25/10/2026): plugin `@capacitor/push-notifications`, ponte `window.AskouTPush` (`apps/mobile/src/push-bridge.ts`), token do aparelho guardado como `apns:<token>` na tabela de inscrições (sem migração) e envio direto pela Apple (APNs, HTTP/2, chave .p8) em `infra/push/apns-sender.ts`; o botão "Ativar avisos" da tela de avisos funciona no app. **Para ligar no servidor:** criar uma chave "Apple Push Notifications service" em developer.apple.com > Keys e colar direto no Render `APNS_KEY_ID`, `APNS_PRIVATE_KEY` (conteúdo do .p8) e conferir `APNS_TEAM_ID=359NDWACC5`; sem isso o botão mostra "não configurado". O arquivo .p8 só baixa uma vez: guardar. **Não testado em aparelho** (entrega real, toque no aviso abrindo a tela certa, token trocado). Builds instalados direto pelo Xcode usam o servidor de teste da Apple (`APNS_ENVIRONMENT=sandbox`); loja e TestFlight usam produção (padrão). Android: falta FCM (plugin já serve, falta o envio).
- [x] "Adicionar à agenda" (25/10/2026): botão na página do evento (e no menu ⋯) gera um .ics; no app abre o menu de compartilhar do celular (`window.AskouTCalendar`, sem permissão de agenda), no navegador baixa o arquivo. Não testado em aparelho.
- [ ] Ainda sem versão nativa: leitura da agenda do aparelho, localização em segundo plano para o Flash, links profundos (Universal Links), contatos do celular, Face ID, widget.
- [ ] A cancelação da otimização de vídeo (sair da tela) ainda não chega ao plugin nativo.
- [ ] O service worker (`sw.js`) roda também dentro do aplicativo; conferir no aparelho se não atrapalha as atualizações.

### Compressão de vídeo antes do envio
Feito: `apps/web/src/lib/video-prepare.ts`. Ao publicar, o app reduz o vídeo (até ~720p, ~3,5 Mbps, MP4/H.264) ANTES de criar o post. Aceita escolher arquivos de até 500 MB quando o aparelho consegue comprimir; o que for enviado continua limitado a 60 MB. Se não der para comprimir, ou o resultado não ficar menor, segue o original. Ordem: plugin nativo → navegador (WebCodecs, biblioteca `mediabunny`, licença MPL-2.0) → original.

- [ ] **Testar em iPhone e Android de verdade** com vídeo grande de câmera (inclusive .mov HEVC do iPhone). No sandbox só foi verificado o caminho VP9/WebM no Chromium; o caminho H.264/MP4 (o usado de fato), a velocidade com aceleração por hardware e a qualidade em filmagem real NÃO foram testados.
- [ ] Casca Capacitor: implementar `window.AskouTVideo.compress(file, { maxEdge, videoBitsPerSecond, onProgress })` → `Promise<File | undefined>`. A casca grava o arquivo no cache, chama o plugin e lê o resultado de volta. O app já usa isso se existir.
- [ ] Plugin recomendado: `capacitor-native-video-compressor` (qualidade alta ≈ 720p). Plano B: plugin próprio com AVAssetExportSession (iOS) e Media3 Transformer (Android).
- [ ] Requisitos Android: `compileSdk` 35+, repositório JitPack, permissões `READ_MEDIA_VIDEO` / `READ_EXTERNAL_STORAGE`, serviço em primeiro plano. iOS: `NSPhotoLibraryUsageDescription` no Info.plist.
- [ ] Avisar a pessoa para manter a tela aberta durante a otimização (o texto já aparece no app).

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
- **Pagamento DESLIGADO por padrão, e a chave fica no portal admin** (menu **Pagamentos**: botão Ligar/Desligar, vale na hora, sem reiniciar, com o motivo na Auditoria). Desligado: nenhum pedido novo é aceito e a tela do app mostra "Impulsionar chega em breve". Anúncios já pagos continuam no ar, e avisos de pagamento e compras de loja que já estavam a caminho ainda são confirmados. A escolha do painel fica no banco (tabela `AppSetting`, chave `payments.enabled`) e vale mais que `PAYMENTS_ENABLED` do `.env`, que passa a ser só o **valor inicial** (padrão `false`) até alguém mexer no painel. O painel **recusa ligar sem provedor de pagamento configurado**, e uma escolha antiga de "ligado" deixa de valer sozinha se o provedor sumir da configuração. Fora de produção o pagamento de teste já existe, então dá para ligar pelo painel e experimentar com "Simular pagamento".
- **Web (Pix e cartão): Stripe Checkout** (`infra/payments/stripe-payment-gateway.ts`). Variáveis: `PAYMENT_PROVIDER=stripe`, `STRIPE_SECRET_KEY` (sk_live_… em produção; chave de teste é recusada), `STRIPE_WEBHOOK_SECRET` (whsec_…), `PUBLIC_WEB_URL` (https, sem barra no fim). O AskouT nunca vê cartão: a pessoa paga na página da Stripe e volta para `/bares/ID/impulsionar?pagamento=ok`. O aviso (`POST /payments/webhook`) tem a assinatura conferida (HMAC-SHA256, tolerância de 5 min, comparação em tempo constante), só libera com `payment_status=paid` em reais **e valor igual ao do pedido**, e é idempotente. **Escrito pela documentação da Stripe e testado só com simulações: nunca falou com uma conta real.** Antes de abrir: criar a conta (CNPJ), ativar Pix, cadastrar o endpoint do webhook (eventos `checkout.session.completed`, `checkout.session.async_payment_succeeded` e `checkout.session.async_payment_failed`) e fazer uma compra de teste ponta a ponta com a chave `sk_test_` e outra real de valor mínimo.
- **Lojas (iOS/Android): compra dentro do app, obrigatória para bens digitais** (confirmar nas diretrizes vigentes da Apple 3.1.1 e do Google Play; a comissão é de 15% a 30%). O fluxo está pronto no servidor: o pedido é criado com `channel` APPLE/GOOGLE (sem cobrança no provedor), o app compra o produto `askout.boost.{1,3,7,14}d` (consumível) e envia o recibo para `POST /me/boosts/:id/store-purchase`; o servidor só libera depois de conferir na loja, recusa recibo de outro produto, devolvido ou já usado em outro pedido, e é idempotente. Preço da loja: `BOOST_STORE_PRICE_PER_DAY_CENTS` (padrão = preço da web), que precisa bater com a tabela de preços cadastrada na loja.
  - **Falta (nada disso existe ainda):** (1) o **verificador real** (`StorePurchaseVerifier` em `core/ports.ts`; hoje não há implementação, então `pricing.store.available` é `false` e a API recusa pedidos de loja): Apple, App Store Server API (consultar a transação, conferir bundle id, produto e `revocationDate`); Google, Play Developer API (`purchases.products.get`, conferir pacote e produto, **reconhecer/consumir a compra em até 3 dias**, senão o Google devolve o dinheiro); (2) a **casca nativa** (Capacitor) com o objeto `window.AskouTStore.purchase(produtoId)` que devolve o recibo (contrato em `apps/web/src/lib/purchase.ts`); (3) cadastrar os 4 produtos nas duas lojas e as contas de desenvolvedor; (4) **notificações de reembolso** das lojas (App Store Server Notifications V2 e Google RTDN) para encerrar o anúncio quando a loja devolver o valor. Reembolso na web (Stripe) também não retira o anúncio hoje.
  - Se a Apple/Google classificarem o impulsionamento como serviço consumido fora do app, a compra por Pix/cartão no app poderia ser permitida; **isso é decisão de revisão da loja e jurídica, não técnica. Não assumir.**
- Preço: pacotes com desconto progressivo (1d R$14,90; 3d R$34,90; 7d R$69,90; 14d R$129,90), iguais na web e nas lojas. Se definir `BOOST_PRICE_PER_DAY_CENTS` (100 a 1.000.000) no Render, volta a valer dias × esse valor (não defina, para manter o desconto); pacotes de 1, 3, 7 ou 14 dias. O anúncio começa na confirmação do pagamento.
- Só o responsável pelo local cria. Um pedido em aberto por alvo (rolê ou evento). Cancelar só antes do pagamento; **não há reembolso nem cancelamento depois de pago**, nem métricas (alcance, cliques) e nem tela de admin para pausar (o estado PAUSED existe no banco).
- Onde aparece: primeiro nos resultados do Explorar (fora do filtro "Bombando") e até 2 eventos na Home ("Rolês em destaque"), com rodízio por hora. Sempre com a etiqueta "Patrocinado" (exigência de transparência publicitária; revisar com advogado, CONAR/CDC).
- Antes de cobrar de verdade: termos de uso do anunciante, política de reembolso, emissão de nota fiscal e CNPJ/regime da empresa. Nada disso está feito.
- Migrações `20261117120000_boosts` e `20261202120000_boost_channel` e `20261202130000_app_settings` escritas à mão e **nunca rodadas em Postgres**; rodar `prisma migrate deploy` + `prisma generate` e testar o `PrismaBoostRepository` (inclui o contrato do recibo único por pedido) antes de publicar.

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

## Mapa do Explorar e lugares do Google

- **Tela** (`/explorar/mapa`): mapa com pins de locais (roxo) e de eventos acontecendo agora (verde-água), carrossel embaixo com seletor "Locais / Acontecendo agora". Tocar num pin troca o carrossel para o tipo dele e leva ao cartão; rolar o carrossel destaca o pin. Os locais vêm de `GET /explore/places` (AskouT + fonte externa, 10 km, até 40). Sem localização, só aparecem os eventos.
- **Mapa-base:** biblioteca MapLibre. Sem configuração usa os blocos públicos do OpenStreetMap, que **não podem ser usados em produção em escala** (política de uso do OSM). Antes do lançamento, definir `VITE_MAP_STYLE_URL` no Cloudflare Pages (site) com um estilo MapLibre: MapTiler (grátis até 100 mil carregamentos/mês, exige atribuição e conta), Stadia Maps, ou Protomaps/PMTiles hospedado no próprio R2 (custo quase zero, mais trabalho). Trocar de provedor é só mudar essa variável.
- **Locais do Google:** continuam sendo consultados ao vivo (não copiados para o banco), por decisão anterior, porque os termos do Google restringem guardar os dados. Precisa de `GOOGLE_PLACES_API_KEY` e de faturamento ativo (cartão) no Google Cloud; sem a chave, o app usa o OpenStreetMap (Overpass), que é grátis mas tem menos dados e quase nenhuma avaliação/foto. Não existe "importação em massa" do Google: quando alguém abre a página de um lugar de fora, ele vira um local do AskouT (só nome, endereço, coordenada e identificador).
- Testado só com API simulada e sem blocos do mapa (a rede do ambiente de teste não alcança o OSM); falta ver em celular real com o mapa-base carregado.

## Limite de requisições

- **O que existe** (`apps/api/src/http/support/rate-limit-policy.ts`, guard global antes da autenticação): 600 requisições por minuto por IP; nas rotas de entrada (login, cadastro, códigos, social) 30 a cada 10 min por IP; tentativas de senha ou código 10 a cada 15 min **por conta** (vale mesmo trocando de IP); pedidos que mandam e-mail 6 por hora por conta. Recusa com 429, mensagem em pt-BR e `Retry-After`. Os números são palpites: ajustar com uso real (as constantes ficam no topo do arquivo).
- **Só vale para uma instância da API.** Contagem em memória: ao reiniciar zera, e com duas instâncias cada uma conta separado. Se escalar, trocar por Redis ou Postgres.
- **IP do cliente:** em produção a API confia em 1 proxy (`TRUST_PROXY_HOPS`, padrão 1, certo para o Railway) para ler o IP em `X-Forwarded-For`. Confirmar depois de subir que o IP lido não é o do proxy (se for, todos dividiriam o mesmo limite).
- **Fora do que já existia:** o núcleo já limitava tentativas de código por pedido, mensagens por minuto e criação de encontros. Não há limite por usuário logado nas demais rotas (só o por IP) nem bloqueio de contas.
- **Desligar para testes locais:** `RATE_LIMIT=off` (recusado em produção).

## Política de Privacidade e Termos de Uso

- **Onde estão:** `/politica-de-privacidade` e `/termos-de-uso` (atenção: `/privacidade` é a tela de configurações, exige login; o Google usa `/politica-de-privacidade`) (públicas, abrem sem login; textos em `apps/web/src/lib/legal-text.ts`). Linkadas no login, no cadastro e em Privacidade. Mostram o aviso "versão preliminar" até `LEGAL_REVIEWED` virar `true`.
- **É um rascunho escrito por mim a partir do que o app faz, não parecer jurídico.** Advogado precisa revisar tudo antes de abrir ao público, principalmente: base legal das recomendações (hoje ligadas por padrão, texto cita legítimo interesse e consentimento), localização para anúncios por região, transferência internacional, prazos de retenção, foro, texto sobre ingressos e responsabilidade.
- **Campos a preencher no texto:** razão social, CNPJ e endereço do controlador (política, seção 1); política de reembolso do impulsionamento (termos, seção 6).
- **E-mail de privacidade:** o texto usa `privacidade@askout.com.br` (ou `VITE_PRIVACY_EMAIL`). Essa caixa ainda **não existe**: criar um encaminhamento no Cloudflare (Email Routing, grátis) para um e-mail seu antes do lançamento.
- **Lacunas entre o texto e o app (resolver ou ajustar o texto):**
  - **Apagar conta e baixar dados já existem** (Privacidade → "Seus dados"; ver a seção abaixo). Falta e-mail de confirmação depois de apagar e tela de "conta apagada".
  - **Idade mínima 18:** o texto afirma 18+, mas o cadastro não pergunta idade. Falta a trava (data de nascimento ou declaração) e decidir o que fazer com quem declarar menos.
  - Conferir se mensagens e posts apagados somem de fato do banco (o texto diz "enquanto a conta existir ou até você apagar").
  - Registrar o aceite dos termos (data e versão) por conta, ainda não é gravado.

## Apagar conta e exportar dados (LGPD)

- **Como funciona:** em Privacidade → "Seus dados". **Baixar meus dados** gera um JSON (`GET /me/export`) com conta, perfil, seguidores, bloqueios, agenda, posts, comentários, mensagens que a pessoa enviou, Flash, encontros, locais seguidos, impulsionamentos, avisos e uso para recomendações. Não leva fotos e vídeos (só o registro de que existem) nem o que outras pessoas escreveram. **Apagar minha conta** (`DELETE /me`) pede o @usuário e, em conta com senha, a senha; quem entra com Google/Apple confirma só com o @usuário.
- **O que a exclusão faz** (`infra/prisma/prisma-account.repository.ts`, uma transação só): apaga perfil, posts, comentários, curtidas, seguidores, bloqueios, agenda, Flash, avisos, região, histórico de uso e pagamentos da pessoa; apaga **todas as mensagens dela**, inclusive em grupos; **cancela e remove encontros que ela organizou**; passa grupos de que é dona para o membro mais antigo (sem outros membros, o grupo some); locais que administrava ficam sem dono; conversa que fica sem ninguém é apagada. A sessão antiga deixa de valer na hora.
- **Recusas:** conta de administração (precisa ser rebaixada antes) e quem tem impulsionamento pago em andamento.
- **Testado contra Postgres de verdade** (`prisma-account.test.ts`, conta cheia com as três chaves estrangeiras que travam a exclusão). Como rodar: ver "Testes no Postgres" abaixo.
- **Decisões que um advogado/contador deve confirmar:**
  - Os **registros de pagamento (Boost) são apagados junto**. Se a lei fiscal exigir guardar, é preciso anonimizar em vez de apagar.
  - Apagar as mensagens de um grupo tira contexto dos outros membros. A alternativa seria manter com "conta apagada".
  - Backups do banco do Railway podem guardar a conta por um tempo; o texto da política não menciona isso.
- **No app nativo:** o download usa um link `download` do navegador, que o WKWebView do iOS pode ignorar. Testar no aparelho; se falhar, usar o menu de compartilhar nativo.
- E-mail de confirmação "sua conta foi apagada" implementado (melhor esforço; usa `EMAIL_REPLY_TO` como contato). Boas-vindas também vai após o cadastro. Ainda não testado com a conta Resend real.
- **Falta:** apagar também arquivos de mídia quando saírem do banco para o R2.

## Testes no Postgres

- Os testes dos repositórios Prisma rodam contra um Postgres de teste, só quando `ASKOUT_TEST_DATABASE_URL` aponta para um banco terminado em `_test` (eles apagam tudo). Neste ambiente, subi um Postgres 16 local, apliquei **todas as migrações** (`prisma migrate deploy`, incluindo as escritas à mão) e a suíte de contrato inteira passou (79 de 79).
- Isso achou um erro de verdade que os testes em memória escondiam: **o índice "uma proposta aberta por votação" nunca tinha sido criado**. Corrigido na migração `20261203120000_date_poll_one_open_proposal` (índice parcial; o Prisma não o enxerga no schema, então um `prisma migrate dev` futuro pode sugerir apagá-lo: não aceitar).
- Continua **sem teste**: o Dockerfile da API, o Railway, a Stripe, os verificadores da Apple/Google.

## Trava de 18 anos no Flash

- **Como funciona (atualizado em 24/10/2026):** o cadastro só aceita 18 anos ou mais e guarda a data de nascimento (`POST /me/age` e `GET /me/age` ainda existem para contas antigas sem data). **Não há mais trava de idade no Flash**: a regra vale no cadastro. Contas antigas marcadas como menor de 18 anos ficam marcadas e só a gestão corrige a data.
- **Limite honesto:** é **autodeclaração**. Quem mente a data passa. Para loja e LGPD isso é o padrão do mercado, mas não é verificação de documento.
- **Dados:** a data fica no cadastro (`User.birthDate`), não aparece no perfil público, entra na cópia dos dados e some junto com a conta. Está citada na Política de Privacidade (aguarda revisão do advogado). Quem já tem conta precisa informar a data na primeira vez que abrir o Flash.
- **Lojas:** ver a resposta dada na conversa (classificação etária do app é do app inteiro, não só do Flash). Preencher o questionário de classificação e a declaração de público-alvo na Apple e no Google Play com isso em mente.

## Idade e aceite no cadastro

- **O que existe:** o cadastro (e-mail ou Google/Apple, na hora de criar a conta) pede **data de nascimento** e o **aceite dos Termos e da Política** (caixa obrigatória). A API recusa sem os dois. Ficam em `User.birthDate`, `User.termsAcceptedAt` e `User.termsVersion`, e entram na cópia dos dados. Quem entra com Google/Apple numa conta que já existe não passa por isso de novo.
- **Idade mínima: 18 anos** (`MIN_ACCOUNT_AGE` em `core/age-service.ts` e `lib/age.ts`), decidida em 24/10/2026. Os Termos e a Política já dizem 18+. O cadastro recusa menores. Contas antigas de menores (se existirem) não são apagadas automaticamente: decidir o que fazer com elas antes do lançamento.
- (Histórico) em 23/10/2026 a decisão era 13+; foi substituída pelo 18+ acima.
- **Ainda vale rever com advogado (histórico do debate sobre 13+):** pelo que sei, o ECA Digital (Lei 15.211/2025) trouxe exigências para serviços que menores acessam (verificação de idade, vínculo com responsável em contas de menores de 16, regras para dados de menores). Não confirmei o texto atual. Se o advogado achar pesado, o caminho mais simples é **subir `MIN_ACCOUNT_AGE` para 18** nos dois arquivos (uma linha em cada).
- **Versão dos Termos:** `TERMS_VERSION` em `core/age-service.ts` ('2026-10-22'). Ao mudar o texto legal, mude a versão. Ainda **não há** tela para pedir novo aceite a quem já tem conta (hoje não há contas reais; precisa existir antes de mudar os termos em produção).
- **Contas criadas antes desta mudança** não têm aceite registrado e não têm data de nascimento (o Flash pede a data na primeira vez).
- Cadastros pendentes antigos foram apagados pela migração (o código vale poucos minutos; quem estava no meio refaz).

## Corrigir a data de nascimento

- Em **Editar perfil → Data de nascimento** (`PUT /me/age`). Regra: quem hoje consta como **maior de 18 anos** corrige sozinho (mínimo 13). Quem consta como **menor de 18 não corrige por aqui** (botão some e aparece "fale com o suporte"), senão bastaria trocar a data para liberar o Flash. Adulto que troca para uma data de menor perde o Flash e também não volta sozinho.
- **Suporte:** no painel, em **Pessoas → Corrigir idade** (`PUT /admin/users/:id/birth-date`), a gestão troca a data de quem ficou bloqueado como menor. Motivo obrigatório; a data antiga e a nova ficam na **Auditoria** ("Corrigiu a data de nascimento"). Não vale para contas de admin nem para menos de 13 anos. Confira a pessoa por fora (ex.: documento enviado ao suporte) antes de corrigir. O link "fale com o suporte" no app depende de `VITE_SUPPORT_EMAIL`.
- Brecha conhecida: a idade é autodeclarada; quem mente a data no cadastro continua passando.

## Lojas (Apple e Google): exigências para apps com conteúdo de usuários

Auditoria feita no código em 22/10/2026. As regras das lojas mudam; confira o texto atual da Apple (App Review Guidelines 1.2) e do Google Play (política de conteúdo gerado por usuários) na hora de enviar.

**Já atende**
- **Denunciar pelo app:** post, comentário, story, conversa/grupo e **perfil** (menu do perfil → "Denunciar perfil"; comentário → "Denunciar"). Todas caem em Gestão → Denúncias, com o texto como estava, decisão e nota na auditoria. Suspender a conta é um clique na própria denúncia.
- **Bloquear** qualquer pessoa, a qualquer momento (perfil e conversa).
- **Termos com regra de conduta e aceite no cadastro** (seção "O que não é permitido" e "Denúncias, bloqueio e moderação"); versão e data do aceite ficam guardadas.
- **Apagar a conta dentro do app** (exigência da Apple) e baixar os dados.
- **Contato publicado:** e-mail de privacidade nos textos legais e suporte na tela Ajuda (precisa de `VITE_SUPPORT_EMAIL` e do e-mail `privacidade@askout.com.br` criados).
- **Trava de idade** no Flash (ver seção própria) e classificação etária coerente (ver abaixo).

**Lacunas e riscos (decidir antes de enviar)**
- **Filtro automático de conteúdo ofensivo: só o mínimo (23/10/2026).** Há uma lista curta de termos inequívocos barrados em @usuário, nome e biografia (`apps/api/src/core/content-filter.ts`, com testes). NÃO filtra posts, comentários nem mensagens. Antes dizia: A Apple cita "um método para filtrar conteúdo impróprio". Hoje só há denúncia + moderação manual. Muitos apps passam assim, mas é o ponto mais provável de questionamento. Opção barata: lista de palavras bloqueadas em @usuário, nome e descrição. Opção mais forte: moderação automática de imagens (serviço pago).
- **Prazo de resposta às denúncias:** os Termos (seção 5) já dizem "em até 24 horas", e a Apple (1.2) exige que isso seja cumprido: alguém precisa olhar o painel admin todo dia, remover o conteúdo e excluir quem o publicou. Bloquear alguém também cria um aviso na fila de moderação (variante BLOCK). Só mude o prazo no texto se não conseguir cumprir.
- **Denunciar eventos e comentários de donos de local:** eventos criados por donos de local não têm botão de denunciar (só dá para a gestão apagar). Vale incluir se a loja questionar.
- **Entrar com Apple:** a Apple exige oferecer "Entrar com a Apple" quando há login com Google. Está implementado, mas **nunca foi testado** (precisa de `APPLE_CLIENT_ID` e domínio HTTPS).
- **Decisão (24/10/2026): a Apple fica em 18+** (Brasil: 16). Isso impede menores de 18 de baixar o app no iPhone. **Feito em 24/10/2026:** `MIN_ACCOUNT_AGE` subiu para 18 (api, web, textos legais e testes), então o cadastro em qualquer canal só aceita 18+.
- **Classificação etária:** é do app inteiro. Responda o questionário contando que há encontros presenciais, conteúdo de usuários, locais que servem bebida alcoólica e um recurso 18+ (Flash). Provável: 17+ na Apple. No Google Play, o público-alvo deve excluir crianças; o app tem conta a partir de 13 anos (decisão jurídica pendente, ver "Idade e aceite").
- **Formulários de privacidade (Apple "Privacy Nutrition Labels" e Google "Segurança dos dados"):** declare e-mail, nome, @usuário, data de nascimento, localização aproximada (Flash e mapa), fotos/vídeos/áudio de conversa e posts, mensagens, identificadores de dispositivo (push), compras. Nenhum dado é vendido; use os textos da Política de Privacidade como base.
- **Compras:** impulsionamento pago dentro do app nativo precisa usar a compra da loja (Apple/Google); os verificadores de recibo **ainda não estão implementados**.

## Novo aceite dos Termos
- Ao mudar `TERMS_VERSION` em `apps/api/src/core/age-service.ts`, quem já tem conta vê uma tela que bloqueia o app até aceitar a versão nova (`GET/POST /me/terms`). Contas antigas, sem registro de aceite, também passam por ela.
- O bloqueio é só na tela do app; a API não recusa chamadas de quem não aceitou. Decidir com o jurídico se isso basta.
- Antes de publicar texto novo dos Termos: trocar `TERMS_VERSION` (e revisar `LEGAL_UPDATED` no site).

## Acessibilidade e desempenho (revisão automática, 22/10/2026)
- Contraste dos textos nos dois temas ≥ 4,8:1 (`--warn` claro tem 3,1:1: só é usado em marcadores e bordas, nunca em texto). Zoom do navegador liberado, `lang="pt-BR"`, foco visível e `prefers-reduced-motion` tratados.
- Verificado só por script no navegador simulado (nomes de botões e campos, `alt`, tamanho de toque). **Falta** teste com leitor de tela real (VoiceOver/TalkBack) e em aparelho de verdade.
- Pacote inicial do site: ~202 KB comprimido; mapa (~285 KB) e leitor de PDF carregam só quando usados. Não medimos tempo de carregamento em rede móvel real.

## Dados de exemplo "[TESTE]" para o primeiro acesso
- `npm run seed:demo` (em `apps/api`) cria 4 pessoas `teste_*` com posts; `-- --follow SEU_USUARIO` faz você e elas se seguirem (viram amigos), `-- --clear` apaga tudo. Roda várias vezes sem duplicar.
- As contas usam e-mail `@teste.askout.invalid` e hash de senha inválido: ninguém consegue entrar nelas. O script **recusa rodar** com `NODE_ENV=production`.
- Lugares e eventos de exemplo: `npm run seed:places` (já existia).
- Antes de abrir ao público: rodar `seed:demo -- --clear` e `seed:places -- --clear` em qualquer banco que tenha recebido esses dados.
- Testado contra Postgres real (criar, repetir, seguir, apagar, recusa em produção). Não visto ainda no app no celular.

## Status da implantação (22/10/2026)
- Feito pelo Sylvio: domínio `askout.com.br` no Cloudflare (DNS), caixas de e-mail `privacidade@`, `contato@` e `suporte@` no Hostinger (plano gratuito **até 12/03/2027**: renovar ou migrar antes), SPF duplicado do Firebase removido. Teste de recebimento e resposta ok.
- Valores a usar: `VITE_SUPPORT_EMAIL=suporte@askout.com.br`, `VITE_PRIVACY_EMAIL=privacidade@askout.com.br`, `EMAIL_REPLY_TO=privacidade@askout.com.br`, `OSM_CONTACT=contato@askout.com.br`.
- Sobras do Firebase antigo no DNS (A do domínio principal, TXT `firebase=`, `firebase1/2._domainkey`): limpar quando o site novo for ligado.
- Resend: conta criada, domínio `askout.com.br` **verificado** e chave de envio já criada e guardada pelo Sylvio (ainda NÃO testada contra a API real). Colar a chave só no Railway (`RESEND_API_KEY`), nunca no chat.
- Cloudflare Pages (22-23/10/2026): projetos `askout-site` (`askout-site.pages.dev`) e `askout-gestao` (`askout-gestao.pages.dev`) criados e com o primeiro deploy concluído, ligados ao repositório `SylvioLuiz/AskouT` (branch `main`; cada push publica sozinho). Domínios `askout.com.br` e `gestao.askout.com.br` adicionados (status "Initializing" na hora). O A antigo do Firebase (`199.36.158.100`) foi substituído por CNAME. Variáveis: `NODE_VERSION=22`, `VITE_API_URL=https://api.askout.com.br` (+ e-mails de suporte/privacidade no site). Falta `VITE_MAP_STYLE_URL` (mapa) e conferir os domínios como Ativos.
- Em 23/10/2026: domínios ativos (respondem 200), mapa configurado, Google feito.
- **API no Render (23/10/2026):** a Railway estava em incidente de segurança (cadastros pausados), então a API foi publicada no **Render** pelo `render.yaml` (Blueprint `askout`, workspace "My Workspace", região Oregon): serviço `askout-api` (Docker, plano Starter) + banco `askout-db` (Postgres, Basic-256mb). `https://api.askout.com.br/saude` responde `{"ok":true}` com HTTPS; CNAME `api` → `askout-api.onrender.com` no Cloudflare, **só DNS (proxy desligado)**. CORS conferido: aceita `https://askout.com.br`, não aceita origem estranha. O site publicado já aponta para `api.askout.com.br`.
  - Preenchidas pelo Sylvio direto no Render: `RESEND_API_KEY` e `GOOGLE_PLACES_API_KEY`. **`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` ficaram vazias**: push desligado por enquanto (ativar depois, colando o par direto no Render).
  - Na primeira partida o deploy falhou (`P1001`: o banco ainda não aceitava conexões quando a migration rodou). Um "Deploy latest commit" manual resolveu. Em novos Blueprints/bancos, esperar o banco ficar disponível antes do primeiro deploy.
  - Ainda NÃO testado contra a API real: envio de e-mail (Resend), login do Google, busca de bares (Places), cadastro e login pelo site, `make-admin`. Backups do banco do Render (plano Basic): conferir a retenção antes de ter dados reais.
  - Custo: planos pagos por segundo de uso; conferir o valor mensal em Billing no Render. Se a Railway normalizar, dá para migrar (mesmo Dockerfile; mover o banco e repontar o `api`).

## Card "Chame a galera" na Home (23/10/2026)
- Aparece na Home enquanto a pessoa tem **menos de 5 amigos** (amigo = follow mútuo) e abre o convite (WhatsApp / compartilhar / copiar link). Constante: `INVITE_CARD_GOAL` em `apps/web/src/lib/invite.ts`.
- Hoje o link compartilhado é o do site (`/cadastro?convite=usuario`), que já faz quem entra seguir quem convidou.
- **Quando o app estiver nas lojas:** definir `VITE_STORE_URL` no Cloudflare Pages (projeto `askout-site`, endereço http(s) da loja) e publicar de novo. O convite passa a compartilhar o link da loja. Atenção: o link da loja **não carrega quem convidou**, então o "seguir automático" deixa de acontecer; para manter, é preciso um link com referência (Android Install Referrer / link dinâmico, ou o código do convidado digitado no cadastro). Decidir antes do lançamento nas lojas.
- Não foi visto numa tela real (só tipos, testes e build). Conferir no celular, nos temas claro e escuro.

## Dados legais preenchidos (22/10/2026)
- Controladora: Thunderbolt LTDA, CNPJ 44.953.028/0001-19 (contrato social JUCESP, 2022). Endereço publicado nos textos: Av. Jabaquara, 1909, sala 62, São Paulo/SP (informado pelo Sylvio; **o contrato social ainda mostra outra sede**: atualizar o endereço na Junta/CNPJ para bater com o que está publicado). Encarregado: Sylvio Luiz de Souza (`privacidade@askout.com.br`). Tudo em `COMPANY` em `apps/web/src/lib/legal-text.ts`.
- Política de reembolso do impulsionamento: **proposta minha**, ainda não confirmada pelo Sylvio nem por advogado (reembolso se não começou a rodar, 7 dias de arrependimento, proporcional se falha nossa).
- Objeto social não cita publicidade: perguntar ao contador se precisa incluir essa atividade (CNAE) antes de vender impulsionamento.
- Restam marcados "[A revisar]": regras do ECA Digital, prazo de resposta a denúncias, e a revisão jurídica geral (`LEGAL_REVIEWED` continua falso).

## Google Login (feito em 2026-10-23)
- Projeto Google Cloud `askout-512422`, cliente OAuth "AskouT Web" (Aplicativo da Web).
- Origens JS autorizadas: https://askout.com.br e https://www.askout.com.br (sem URIs de redirecionamento: fluxo por ID token).
- `GOOGLE_CLIENT_ID` (público, não é segredo) = 427546548243-44jukkdjh3sgl1rooj0hbs4oi21ig0a4.apps.googleusercontent.com
- A chave secreta do cliente não é usada pela API (não guardar).
- Tela de consentimento: Externa, **publicada em produção em 2026-10-23** (escopos básicos, sem logotipo, então sem verificação). Branding com página inicial, /privacidade, /termos-de-uso e domínio askout.com.br. E-mail de suporte exibido ao usuário ainda é pessoal (sylviofox@gmail.com); trocar por suporte@askout.com.br exige um grupo do Google.
- Login nativo (app Capacitor) exigirá clientes Android/iOS próprios depois.

## Mapa (feito em 2026-10-23)
- Chave MapTiler "AskouT Web" criada (plano gratuito), restrita às origens askout.com.br, *.askout.com.br e localhost (a chave é de frontend, pública por design; a restrição de origem é a proteção).
- `VITE_MAP_STYLE_URL` = `https://api.maptiler.com/maps/streets-v2/style.json?key=<chave>` definida no projeto Cloudflare Pages `askout-site`.
- App nativo (Capacitor): MapTiler não aceitou `capacitor://localhost` como origem; ao fazer o app, testar se o mapa carrega ou criar uma segunda chave sem restrição de origem com restrição de user-agent.
- Conferir uso no painel do MapTiler (limite do plano gratuito) depois do lançamento.

## Verificação do Dockerfile (2026-10-23)
- Passos do Dockerfile reproduzidos numa cópia limpa (só arquivos versionados): `npm ci`, `prisma generate`, `migrate deploy` e a API subiu em modo production com `EMAIL_TRANSPORT=resend`; `/saude` respondeu `{"ok":true}` e o CORS respondeu para `https://askout.com.br`. A imagem Docker em si não foi construída (sem daemon).
- `render.yaml` (plano B) na raiz do repositório.

## Google: verificação de marca (feito em 2026-10-23)
- Link da política corrigido para `/politica-de-privacidade` (antes apontava para a tela com login).
- Domínio `askout.com.br` verificado no Google Search Console por registro TXT no Cloudflare (`google-site-verification=...`). **Não apagar esse registro**, senão a verificação da marca cai.
- Status no Google Auth Platform → Branding: "marca verificada e aparecendo para os usuários". Logotipo NÃO enviado de propósito (enviar logotipo exige verificação completa do app).

## Apagar conversa e grupo (23/10/2026)
- Conversa 1 a 1: menu da conversa → "Apagar conversa" (só para você): some da lista e das suas mensagens; a outra pessoa continua vendo; se ela escrever de novo, volta só com as mensagens novas. Usa o mesmo `POST /conversations/:id/clear` do "Limpar conversa".
- Grupo: membro sai ("Sair do grupo", já existia); quem criou também pode "Apagar grupo para todos" (`DELETE /conversations/:id/group`): apaga conversa, mensagens e membros; os outros recebem aviso (tipo `GROUP_REMOVED`); encontros já marcados continuam na agenda sem o grupo.
- Testado: testes automáticos (memória e Postgres real). NÃO testado: as telas num navegador/aparelho nem a rota HTTP nova.
- Segue sem apagar: notificações (só marcar como lida), mensagens recebidas de outras pessoas (só some para você), data de nascimento (só com a conta).

## Chave do Google Places (criada em 23/10/2026)
- Projeto `askout-512422`: chave "AskouT API Places (servidor)", restrita só à **Places API (New)** (sem restrição por IP: Railway/Render não têm IP fixo). O valor aparece em Google Cloud → APIs e serviços → Credenciais → "Exibir chave". **Nunca colar no chat nem no GitHub**: colar direto em `GOOGLE_PLACES_API_KEY` no Railway (ou na `.env` local de `apps/api` para teste).
- Existe também a chave automática "Maps Platform API Key" (22/10), liberada para 32 APIs: excluir ou restringir, porque é permissiva demais e não é usada pelo app.
- Falta: definir orçamento e alerta de gasto na conta de cobrança do Google Cloud; `GOOGLE_DAILY_LIMIT` na API limita as consultas por dia.
- A busca real no Google ainda NÃO foi testada (só com respostas simuladas).

## Agenda importada do local (iCal / Google Agenda)

- Dono do local abre o local → **Agenda**: cola o endereço iCal, escolhe na roleta (1 a 30) quantos dias antes cada evento sobe. Nada sobe sem aprovação: um dia antes da data de subir chega um aviso (tipo `VENUE_CALENDAR`) com a prévia; dá para editar tudo (nome, data, tipo, descrição, hashtags, ingresso, imagem por link https) antes de aprovar.
- Job `CalendarImportJob` roda a cada 5 min na API (lê agendas a cada 6 h, avisa, publica). A migração `20261205120000_venue_calendar` roda sozinha no deploy do Render.
- O link da agenda é segredo do dono: fica só no banco e nunca volta inteiro nas respostas (só o site). Leitura com proteção contra endereços internos (só https, IP público, 2 MB, 10 s). Mencionar no texto de privacidade na revisão jurídica.
- **Não testado com Google Agenda real** (o sandbox não alcança a internet): validar com um calendário de verdade após o deploy. Foto enviada do aparelho não vale para eventos importados (só link https).

- [ ] Google Play (24/10/2026): conta de desenvolvedor PESSOAL "Sylvio Luiz" (SylvioFox@gmail.com) já existe; o Google está verificando a identidade (documentos enviados, pode levar dias) e só depois pede a verificação do telefone de contato (código por SMS/ligação: só o dono faz). Enquanto isso o Play Console não deixa criar o app. Atenção: conta pessoal nova exige teste fechado com pelo menos 12 testadores por 14 dias seguidos antes de pedir a publicação. Depois: criar app, ficha, classificação, segurança de dados, produtos `askout.boost.{1,3,7,14}d` (mesmos preços da Apple), e implementar a verificação de compra do Google (ainda não existe).

- [x] Login nativo da Apple no app (24/10/2026): plugin `@capgo/capacitor-social-login` + ponte `window.AskouTApple` (iOS); a web usa a ponte se existir, senão a janela do site. Servidor já aceita o bundle id. **Sem teste em aparelho** (ver `apps/mobile/IOS.md`). O Android ainda não foi sincronizado com o plugin (rode `npm run sync` ao preparar o Android e confira se compila).

- **iOS build 1.0 (3) enviado (24/10/2026):** inclui o app traduzido (português, inglês e espanhol; seletor em Perfil > Tema e idioma; idioma inicial segue o do aparelho). Builds 1.0 (1) e (2) também já estão na App Store Connect. Textos legais (Termos e Privacidade) continuam só em português até a revisão do advogado; mensagens dinâmicas do servidor (e-mails, notificações) também seguem em português. Falta: preencher a página do app, anexar build + 4 compras, enviar para revisão.
- **Chave APNs criada (24/10/2026):** Key ID `W99F46YPLF`, Team `359NDWACC5`, sandbox + produção; arquivo `.p8` baixado na pasta Downloads do Mac (não dá para baixar de novo). Falta colar no Render `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`.
- **App ID `br.com.askout`:** Sign in with Apple, Push Notifications e In-App Purchase ativados (conferido).
- **Compras `askout.boost.{1,3,7,14}d`:** print de revisão (1290×2796, dados [TESTE]) anexado às 4 (arquivos em `apps/mobile/store/iap-review/`, gerados por `gerar-prints.cjs`). Continuam "Preparar para envio": a primeira compra consumível só vai junto com uma nova versão do app. Preço em BRL não conferido pelo painel.
- Ainda sem teste em iPhone de verdade: push, calendário, login Apple, compra Sandbox (precisa de testador Sandbox criado pelo usuário).

## App Store: envio para revisão (25/10/2026)
- Versão 1.0 (build 3) enviada à Apple em 25/10/2026 00:10 (status "Waiting for Review"; prazo de até 48 h, resposta por e-mail). Preço grátis (base Brasil), disponível só no Brasil; página do app (textos, prints iPhone/iPad, App Privacy) preenchida; conta de demonstração `apple-review@askout.com.br` com a senha digitada pelo Sylvio.
- **As 4 compras (impulsionamento) NÃO foram anexadas à submissão**: a seção "In-App Purchases" não apareceu na página da versão e o rascunho de submissão só tinha o item da versão. Elas seguem "Prepare for Submission". Enviar junto com a próxima versão (1.0.1) ou assim que o painel permitir. Preços em reais ainda não conferidos.
- Ajustes visuais feitos depois do build 3 (título da tela de login mais fino e em 2 linhas, logo da capa maior) só entram no app num próximo build; no site já estão no ar.
- Build 1.0 (4) enviado ao App Store Connect em 25/10/2026 ~01:35 (só para TestFlight; a revisão segue com o build 3). Traz título de login fino em 2 linhas, logo neon maior e página /suporte. Árvore `public` antiga do build 3 guardada em `~/Documents/AskouT-ios/old-build3` no Mac.
- Build 1.0 (5) enviado ao App Store Connect em 25/10/2026 ~02:12 (só TestFlight): igual ao 4 + novo ícone (logo colorido sem círculo/texto, fundo branco, 1024x1024 sem transparência). A tela de abertura (splash) ainda usa a arte antiga com círculo neon e "ASKOUT"; o ícone do Android também não foi trocado.

## Android / Google Play (25/10/2026)
- **Feito:** ícone novo (logo sobre fundo preto) em iOS, Android, site e portal (`apps/mobile/scripts/make-icons.py`; a tela de abertura NÃO foi trocada); imagens da ficha em `apps/mobile/store/` (`screenshots-play/` 1080x2160, `play-listing/icone-512.png` e `destaque-1024x500.png`); assinatura de release no Gradle via `android/keystore.properties` (fora do git); `.aab` assinado compilado no sandbox (`./gradlew bundleRelease`, SDK 36 instalado em /opt/android-sdk; o espelho `repo.maven.apache.org` falha de forma intermitente: usei um `~/.gradle/init.d/mirror.gradle` local que aponta para o espelho do Google Cloud).
- **Chave de assinatura (upload key):** `askout-upload.jks` + senhas em `~/Documents/AskouT-android/chave-de-assinatura/` no Mac do Sylvio. Fazer cópia de segurança fora do computador. Com o Play App Signing ligado, perder a upload key é recuperável pelo suporte do Google; mesmo assim guardar. NUNCA no GitHub.
- **Servidor:** FCM (`infra/push/fcm-sender.ts`, prefixo `fcm:`), conferência de compra do Google Play (`infra/store/google-play-verifier.ts`, recibo `{productId, purchaseToken}`) e conta de serviço Google (`infra/google/service-account.ts`). Liga com `GOOGLE_SERVICE_ACCOUNT_JSON` no Render (conteúdo do JSON da conta de serviço) e, opcional, `GOOGLE_PLAY_PACKAGE_NAME` (padrão `br.com.askout`). Testes com respostas simuladas passam; **nada foi testado contra o Google de verdade**.
- **Falta para o Android funcionar:** (1) projeto Firebase com o app Android `br.com.askout` e o `google-services.json` em `apps/mobile/android/app/` (sem ele o push não funciona e o app compila sem o plugin); (2) conta de serviço com papel "Firebase Cloud Messaging API Admin" e convidada no Play Console (Usuários e permissões > Convidar, com permissões financeiras/ver dados do app) para conferir compras; (3) produtos `askout.boost.{1,3,7,14}d` no Play Console; (4) Google Play: conta ainda em verificação de identidade (24-25/10/2026) e, por ser conta pessoal nova, teste fechado com 12+ testadores por 14 dias antes da produção.
- Android: login Apple/Google nativo e `@capgo/capacitor-social-login` compilaram, mas nada foi aberto num aparelho.

## Feed: quem você segue (26/10/2026)
- Decisão do Sylvio: o Início passa a mostrar os posts de **quem você segue**, mesmo sem seguir de volta (antes só amigos = seguimento mútuo). Continua valendo: perfil privado só aparece para quem foi aceito, bloqueio esconde nos dois sentidos, evento privado não entra. Amizade (mútuo) segue valendo para Flash, chat, marcações etc.
- Textos: "Posts de quem você segue". Testes do servidor e do web passam; o teste de contrato do Prisma (`listFollowingIds`) não rodou contra banco real. **Mencionar na Política de Privacidade (revisão do advogado).**

## Explorar: amplia a busca sozinho (26/10/2026)
- Ao abrir o Explorar e não haver evento para hoje, a tela testa, na ordem, esta semana, próximos 30 dias, sem o filtro de tema (escolha inicial) e raio máximo, e já deixa selecionado o primeiro filtro que tem evento, com o aviso "Nada para hoje. Mostrando: …". Roda uma vez, só se a pessoa ainda não mexeu em nenhum filtro. Testado: a lista de passos (unidade). **Não testado no aparelho** com dados reais.

## iOS build 1.0 (6) (26/10/2026)
- Enviado ao App Store Connect em 26/10/2026 13:44 (arquivado no Xcode do MacBook). Inclui: ícone com fundo preto, Início com posts de quem se segue, Explorar que amplia a busca sozinho. O 1.0 (3) continua sendo o enviado à revisão da Apple (rejeitado por "Information Needed", Guideline 2.1: falta responder com vídeo e notas); trocar pelo build 6 na página da versão antes de reenviar.
- **iOS build 1.0 (7) enviado em 26/10/2026 14:20** (substitui o 6): agora sim com o **ícone de fundo preto** (o build 6 saiu com o ícone antigo: eu havia copiado só o site, sem a pasta de ícones), o link do bar nos posts de evento e o post do estabelecimento na Home do dono. O build a anexar na versão 1.0 é o 7.

## Android: google-services.json (26/10)
- `apps/mobile/android/app/google-services.json` (projeto Firebase askout-2cdcd, pacote br.com.askout) adicionado; o plugin google-services passa a ser aplicado no build. É config de cliente, não segredo.
- Falta: conta de serviço FCM (`GOOGLE_SERVICE_ACCOUNT_JSON` no Render), reconstruir o AAB e testar push em aparelho real (não testado).

## Rejeição da Apple 1.2 / 2.3.6 (29/10)
- 2.3.6: questionário de classificação etária → "Age Assurance" = Não (o app não tem controle parental nem verificação de idade além da data de nascimento). Resultado segue 18+ (Brasil 16).
- 1.2: Termos agora dizem "Tolerância zero", análise de denúncias em até 24 horas e exclusão de quem publicar conteúdo ofensivo (sem colchetes pendentes). **Cumprir esse prazo é compromisso operacional:** olhar o painel de denúncias todo dia.
- Bloquear alguém agora também cria um registro na fila de denúncias do painel (`variant: 'BLOCK'`, motivo "Outro", texto "Aviso automático…"), sem apagar uma denúncia anterior. Exige deploy da API; o texto novo dos Termos no app exige novo build iOS (8).
- Pendente: vídeo em aparelho físico (termos no cadastro, denúncia, bloqueio) para responder à Apple e colocar nas Notes.

## Apple 1.0 (7): segunda rejeição (29/10)
- 2.3.6: "Age Assurance" do questionário de classificação passou para No (resultado igual: 18+, Brasil 16). Feito no App Store Connect.
- 1.2: o app já tem Termos no cadastro (checkbox), denunciar e bloquear. Falta o vídeo em aparelho físico mostrando: Termos antes do cadastro, denúncia e bloqueio. Depois: anexar na resposta à Apple e no campo Notes, e reenviar o build 7 (sem build novo).

## Recuperar senha / telas de código (29/10)
- Site: botão "<" (voltar) no topo esquerdo das telas de código (cadastro e recuperar senha); se não existe conta com o e-mail/@usuário, mostra o aviso e depois de 3 s vai para o login. O servidor já avisa (publicado no Render).
- O app iOS (build 7) só tem isso quando sair um build novo; só o aviso do servidor já vale nele. Não foi visto em tela real (só tipos e testes).

## Build 8 (29/10)
- Inclui: botão "<" nas telas de código, redirecionar ao login sem conta (3 s), bolinhas do carrossel menores (4 px), recuperar senha avisa quando não há conta. Versão do projeto = 8. Enviado ao App Store Connect em 29/10 (1.0 build 8); processamento no TestFlight pela Apple.

## Build 9 (29/10)
- Corrige as bolinhas do carrossel: a regra de área de toque (44 px) esticava a bolinha visível; agora 4 px (5 px a ativa), com área de toque de 16x28 px. Medido em Chromium; falta ver no iPhone.

## Termos e Política em inglês e espanhol (29/10, build 10)
- `legal-text-en.ts` e `legal-text-es.ts`: traduções de cortesia dos Termos de Uso e da Política de Privacidade, mostradas conforme o idioma do app, com aviso "se houver diferença, vale o português". Mesma estrutura de blocos (testada).
- Pendente: o advogado revisar as traduções junto com o texto em português. Os trechos "[A revisar com advogado…]" (privacidade 10 e termos 7) aparecem nos três idiomas e devem sair só depois dessa revisão.
- Construído como build 10 (inclui o build 9).
