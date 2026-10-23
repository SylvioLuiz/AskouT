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

Como gerar (no seu Mac, com Android Studio e Xcode instalados):
1. `cd apps/mobile && VITE_API_URL=https://api.seudominio.com.br npm run sync` (gera `www/` e copia para as duas plataformas).
2. `npx cap open android` / `npx cap open ios` e rodar num aparelho ou emulador.

- [ ] Confirmar o `appId` (`br.com.askout.app`, em `apps/mobile/capacitor.config.ts`): vale também para a Apple e o Google e NÃO muda depois de publicar.
- [ ] Na API de produção, incluir `https://localhost,capacitor://localhost` em `CORS_ORIGINS` (o app roda nessas origens). A API precisa estar em https.
- [ ] Primeira compilação em Android Studio e Xcode (assinatura e versão; ícones e tela de abertura já vêm do logo, gerados por `apps/mobile/scripts/make-icons.py`, mas ainda não foram vistos num aparelho). Xcode: ativar a capacidade "In-App Purchase".
- [ ] Testar as pontes em aparelho: compressão (iPhone e Android), compra de teste (sandbox da Apple e testadores do Google Play), e se `fetch` do arquivo comprimido funciona no WebView.
- [ ] Cadastrar o produto de compra única "impulsionamento por dia" nas duas lojas com o mesmo identificador usado pelo servidor.
- [ ] Notificações push (lembrete de evento, Flash) e agenda do celular ainda não têm plugin.
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
- Preço: R$ 15,00 por dia (`BOOST_PRICE_PER_DAY_CENTS`, de 100 a 1.000.000); pacotes de 1, 3, 7 ou 14 dias. O anúncio começa na confirmação do pagamento.
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

- **Como funciona:** ao abrir o Flash, a pessoa informa a data de nascimento uma única vez (`POST /me/age`; `GET /me/age` diz se já informou e se é maior de idade). Menor de 18 anos fica bloqueado no Flash e não consegue trocar a data. A API também recusa (403) ligar o Flash, ver disponíveis, convidar e responder convite sem 18+, então burlar a tela não adianta. O resto do app continua liberado.
- **Limite honesto:** é **autodeclaração**. Quem mente a data passa. Para loja e LGPD isso é o padrão do mercado, mas não é verificação de documento.
- **Dados:** a data fica no cadastro (`User.birthDate`), não aparece no perfil público, entra na cópia dos dados e some junto com a conta. Está citada na Política de Privacidade (aguarda revisão do advogado). Quem já tem conta precisa informar a data na primeira vez que abrir o Flash.
- **Lojas:** ver a resposta dada na conversa (classificação etária do app é do app inteiro, não só do Flash). Preencher o questionário de classificação e a declaração de público-alvo na Apple e no Google Play com isso em mente.

## Idade e aceite no cadastro

- **O que existe:** o cadastro (e-mail ou Google/Apple, na hora de criar a conta) pede **data de nascimento** e o **aceite dos Termos e da Política** (caixa obrigatória). A API recusa sem os dois. Ficam em `User.birthDate`, `User.termsAcceptedAt` e `User.termsVersion`, e entram na cópia dos dados. Quem entra com Google/Apple numa conta que já existe não passa por isso de novo.
- **Idade mínima: 13 anos** (`MIN_ACCOUNT_AGE` em `core/age-service.ts`; o site avisa com o mesmo número em `lib/age.ts`). De 13 a 17 tem conta, sem Flash.
- **Decisão do Sylvio (23/10/2026):** manter **13+** para ter conta (só o Flash é 18+), mesmo sem revisão jurídica, sabendo do risco abaixo. Riscos apontados: idade só declarada, mensagens entre adultos e adolescentes, recomendações por perfil e Boost, localização. Revisar com o advogado o quanto antes; se ele achar pesado, é só subir `MIN_ACCOUNT_AGE` para 18.
- **DECISÃO JURÍDICA PENDENTE (importante):** pelo que sei, o ECA Digital (Lei 15.211/2025) trouxe exigências para serviços que menores acessam (verificação de idade, vínculo com responsável em contas de menores de 16, regras para dados de menores). Não confirmei o texto atual. Se o advogado achar pesado, o caminho mais simples é **subir `MIN_ACCOUNT_AGE` para 18** nos dois arquivos (uma linha em cada).
- **Versão dos Termos:** `TERMS_VERSION` em `core/age-service.ts` ('2026-10-22'). Ao mudar o texto legal, mude a versão. Ainda **não há** tela para pedir novo aceite a quem já tem conta (hoje não há contas reais; precisa existir antes de mudar os termos em produção).
- **Contas criadas antes desta mudança** não têm aceite registrado e não têm data de nascimento (o Flash pede a data na primeira vez).
- Cadastros pendentes antigos foram apagados pela migração (o código vale poucos minutos; quem estava no meio refaz).

## Corrigir a data de nascimento

- Em **Editar perfil → Data de nascimento** (`PUT /me/age`). Regra: quem hoje consta como **maior de 18 anos** corrige sozinho (mínimo 13). Quem consta como **menor de 18 não corrige por aqui** (botão some e aparece "fale com o suporte"), senão bastaria trocar a data para liberar o Flash. Adulto que troca para uma data de menor perde o Flash e também não volta sozinho.
- **Suporte:** no painel, em **Pessoas → Corrigir idade** (`PUT /admin/users/:id/birth-date`), a gestão troca a data de quem ficou bloqueado como menor. Motivo obrigatório; a data antiga e a nova ficam na **Auditoria** ("Corrigiu a data de nascimento"). Não vale para contas de admin nem para menos de 13 anos. Confira a pessoa por fora (ex.: documento enviado ao suporte) antes de corrigir. O link "fale com o suporte" no app depende de `VITE_SUPPORT_EMAIL`.
- Brecha conhecida: uma pessoa de 13 a 17 anos que mentiu no cadastro e disse ter 18+ continua passando (é autodeclaração).

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
- **Prazo de resposta às denúncias:** os Termos dizem "meta de até 24 horas" entre colchetes. Alguém precisa olhar o painel todo dia (o painel mostra o total de denúncias abertas no menu). Ajuste o prazo no texto para o que você consegue cumprir.
- **Denunciar eventos e comentários de donos de local:** eventos criados por donos de local não têm botão de denunciar (só dá para a gestão apagar). Vale incluir se a loja questionar.
- **Entrar com Apple:** a Apple exige oferecer "Entrar com a Apple" quando há login com Google. Está implementado, mas **nunca foi testado** (precisa de `APPLE_CLIENT_ID` e domínio HTTPS).
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
