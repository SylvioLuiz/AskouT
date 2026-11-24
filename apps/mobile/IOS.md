# Compilar e enviar o app para iPhone (passo a passo, no seu Mac)

Nada disto foi compilado antes: o ambiente do Claude não tem Xcode. Espere achar pequenos erros na primeira vez e mande a mensagem do Xcode para o Claude corrigir.

Dados já cadastrados na Apple (equipe pessoal "Sylvio Luiz", Team ID 359NDWACC5):
- Bundle ID: `br.com.askout` (já está no projeto)
- Nome no App Store Connect: o que aparece em Distribution → App Information (hoje "AskouT app")
- Entrar com a Apple e compras no app já estão habilitados no App ID

## 1. Preparar o Mac (uma vez)
1. Instalar **Xcode** pela Mac App Store (versão recente) e abri-lo uma vez para aceitar a licença.
2. Instalar o **Node 22 ou mais novo** (`node -v` para conferir).
3. Em Xcode → Settings → Accounts, entrar com o Apple ID da conta pessoal (o mesmo do App Store Connect).

## 2. Baixar o código e gerar o app
```
git clone https://github.com/SylvioLuiz/AskouT.git
cd AskouT
npm install
cd apps/mobile
VITE_API_URL=https://api.askout.com.br npm run sync
npx cap open ios
```
O último comando abre o projeto no Xcode.

## 3. Configurar no Xcode (uma vez)
1. Clique no projeto **App** (barra da esquerda) → alvo **App** → aba **Signing & Capabilities**.
2. Marque **Automatically manage signing** e escolha em **Team** a equipe "Sylvio Luiz (Personal Team)" ou o nome que aparecer com o Team ID 359NDWACC5.
3. Confira que **Bundle Identifier** é `br.com.askout`.
4. Botão **+ Capability** e adicione:
   - **In-App Purchase** (compras do impulsionamento)
   - **Sign in with Apple** (a Apple exige, pois há login com Google)
5. Aba **General**: Version `1.0` e Build `1`. A cada novo envio, aumente o Build (2, 3, ...).
6. Se a Apple pedir ícone ou tela de abertura: os arquivos já estão gerados em `apps/mobile/ios/App/App/Assets.xcassets`; confira que o ícone aparece preenchido.

## 4. Testar no iPhone (recomendado antes de enviar)
1. Ligar o iPhone no Mac por cabo, ativar o **Modo Desenvolvedor** (Ajustes → Privacidade e Segurança).
2. No topo do Xcode, escolher o iPhone como destino e apertar **Play**.
3. Conferir: abrir o app, entrar, criar um post com foto e vídeo, permitir localização, ver o Explorar.
4. Se algo falhar, copie a mensagem (aba "Report" ou o console do Xcode) e mande ao Claude.

## 5. Enviar ao TestFlight / App Store
1. No topo do Xcode, destino **Any iOS Device (arm64)**.
2. Menu **Product → Archive**. Quando terminar, abre a janela *Organizer*.
3. Selecione o arquivo gerado → **Distribute App** → **App Store Connect** → **Upload** e siga os padrões.
4. Em 10 a 30 minutos o build aparece em App Store Connect → TestFlight (a Apple faz uma checagem automática antes).
5. Em TestFlight, responder a pergunta de criptografia: o app usa só criptografia padrão (HTTPS), então a resposta é "não usa criptografia isenta/própria"; o Claude ajuda a decidir.

## 6. Preparar a página da loja (App Store Connect, versão 1.0)
Feito pelo Claude depois que houver um build e capturas de tela:
- descrição, palavras-chave, URL de suporte e de marketing
- capturas de tela do iPhone (as mesmas servem para os produtos de compra)
- anexar o build, os 4 produtos `askout.boost.*` e enviar para revisão

O primeiro produto de compra precisa ser enviado junto com a primeira versão do app.

## Compartilhar com o AskouT (Share Extension)
O iPhone mostra o AskouT na folha de compartilhar de qualquer app (Fotos, Arquivos, Safari...). Como no WhatsApp, a
folha lista as conversas e os amigos: a pessoa escolhe para quem vai (até 10), escreve uma mensagem opcional e envia
sem sair do app em que estava. Fotos (reduzidas até 1600 px), vídeos até 60 MB, PDF/Word/Excel/PowerPoint/texto até
25 MB e links.

- Código: `ios/App/ShareExtension/` (alvo **ShareExtension**, bundle `br.com.askout.ShareExtension`, embutido no app).
- Sessão: o app grava o token no Keychain compartilhado (`ShareSessionPlugin.swift`, grupo
  `<TeamID>.br.com.askout.shared`). Quem nunca entrou no app neste iPhone vê "Entre no AskouT".
- **Não precisa de App Group** nem de configurar nada no portal: o GitHub Actions cria o App ID
  `br.com.askout.ShareExtension` e o perfil dele sozinho (`.github/scripts/ios-dev-profile.mjs`).
- **Versão:** a extensão tem `MARKETING_VERSION` própria (hoje 1.0.9). Ao mudar a versão do app no Xcode, mude a da
  extensão também (alvo ShareExtension → General → Version), senão a Apple recusa o envio. O número do build vem do
  GitHub Actions para os dois.
- Nunca foi compilado: no primeiro build, se o Xcode reclamar, mande a mensagem ao Claude. No Mac, com assinatura
  automática, selecione a equipe também no alvo **ShareExtension** (Signing & Capabilities).
- Teste: em Fotos, escolha uma foto → Compartilhar → AskouT (se não aparecer, role a fileira de apps até "Mais" e ative).

## Widgets da tela inicial e da tela bloqueada (AskouTWidgets)
Quatro widgets, todos com a agenda pessoal (encontros confirmados e eventos com "Eu vou") e o NOW:
- **Próximo encontro**: pequeno e médio na tela inicial; retangular, redondo e em linha na tela bloqueada.
- **Encontro ativo**: o encontro do NOW em andamento (com quem, onde e quanto falta) ou o plano que está rolando, com a
  barra até o fim. Pequeno, médio e retangular na tela bloqueada.
- **Agenda**: médio (3 planos) e grande (6, com o dia).
- **Amigos no NOW**: quantos amigos estão livres, convites esperando e o atalho para ligar o seu. Pequeno; redondo,
  retangular e em linha na tela bloqueada.

Como funciona:
- Código: `ios/App/AskouTWidgets/` (alvo **AskouTWidgets**, bundle `br.com.askout.Widgets`, iOS 16+, embutido no app).
- Dados: `GET /me/widgets` na API, com o token do Keychain compartilhado (o mesmo da Share Extension). Quem nunca entrou
  no app neste iPhone vê "Entre no AskouT". O app pede para recarregar ao entrar, ao sair e ao ir para o segundo
  plano (`WidgetsPlugin.swift`); fora isso o iPhone busca de novo a cada ~30 min, e entre as buscas a linha do tempo
  troca sozinha quando um plano começa ou termina.
- Tocar abre a tela certa no app (`br.com.askout://now`, `/conversas/<id>`, `/eventos/<id>`, `/agenda`).
- **Não precisa de App Group** nem de configurar nada no portal: o GitHub Actions cria o App ID `br.com.askout.Widgets`
  e o perfil dele, como nas outras extensões.
- **Versão:** como as outras extensões, tem `MARKETING_VERSION` própria (1.0.9). Ao mudar a versão do app, mude a do
  alvo AskouTWidgets também.
- Nunca foi compilado: no primeiro build, se o Xcode reclamar, mande a mensagem ao Claude. No Mac, com assinatura
  automática, selecione a equipe também no alvo **AskouTWidgets**.
- Teste: segure a tela inicial → **+** → AskouT. Na tela bloqueada: segure a tela → Personalizar → Tela Bloqueada →
  toque na área dos widgets → AskouT.

No Android os mesmos quatro widgets estão em `android/app/src/main/java/br/com/askout/widgets/` (o Android não tem
widgets na tela bloqueada). Teste: segure a tela inicial → Widgets → AskouT.

## Pontos de atenção conhecidos
- **Login com Apple dentro do app:** no iPhone o app usa a janela NATIVA da Apple (plugin `@capgo/capacitor-social-login`, ponte `AskouTApple` em `src/apple-bridge.ts`); o servidor aceita o token com o bundle id como público (`APPLE_APP_ID=br.com.askout`). Nunca foi compilado nem testado em aparelho: no teste, toque em "Continuar com a Apple" e confirme que entra. Se o Xcode reclamar do plugin (ele traz junto as bibliotecas do Facebook e do Google), mande a mensagem ao Claude. Lembre de ter a capacidade **Sign in with Apple** no Xcode (passo 3).
- **Verificação de compra:** o servidor confere a transação assinada do StoreKit 2 (cadeia de certificados até a raiz da Apple, bundle id, produto e devolução) quando `APPLE_APP_ID` está definido. Nunca foi testada com uma transação real da Apple, só com uma cadeia de teste: faça uma compra Sandbox antes de abrir ao público. O Google Play ainda não é conferido.
- **Push, agenda do celular e cancelamento de otimização de vídeo** ainda não existem no app nativo (ver GOLIVE.md).
- Teste de compra: usar uma conta "Sandbox tester" criada em App Store Connect → Users and Access → Sandbox.

## 7. Enviar ao TestFlight sem Mac (GitHub Actions)
O fluxo `.github/workflows/ios-testflight.yml` gera e envia o build num Mac do GitHub. Nunca envia para revisão da loja.

Configuração (uma vez):
1. App Store Connect → Users and Access → Integrations → App Store Connect API → **Generate API Key** com acesso **Admin** (precisa ser Admin para o Xcode criar o certificado de distribuição sozinho). Baixar o `.p8` (só baixa uma vez) e anotar o **Key ID** e o **Issuer ID**.
2. GitHub → repositório → Settings → Secrets and variables → Actions → New repository secret: `ASC_KEY_ID`, `ASC_ISSUER_ID` e `ASC_KEY_P8` (abrir o `.p8` num editor de texto e colar o conteúdo inteiro, com as linhas BEGIN/END).

Envio: automático a cada push na main (manda o que estiver na main). Também dá para rodar à mão em Actions → "iOS → TestFlight" → Run workflow. O número do build é 13 + o número da execução.
