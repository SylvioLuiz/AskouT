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
