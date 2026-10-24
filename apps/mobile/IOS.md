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

## Pontos de atenção conhecidos
- **Login com Apple dentro do app:** o servidor agora aceita também o bundle id (`APPLE_APP_ID=br.com.askout`) como público do token. Mas o app ainda NÃO tem o plugin de login nativo da Apple: o botão da web usa uma janela do site e deve falhar dentro do app. Se falhar no teste, avise o Claude (falta um plugin como `@capgo/capacitor-social-login`).
- **Verificação de compra:** o servidor confere a transação assinada do StoreKit 2 (cadeia de certificados até a raiz da Apple, bundle id, produto e devolução) quando `APPLE_APP_ID` está definido. Nunca foi testada com uma transação real da Apple, só com uma cadeia de teste: faça uma compra Sandbox antes de abrir ao público. O Google Play ainda não é conferido.
- **Push, agenda do celular e cancelamento de otimização de vídeo** ainda não existem no app nativo (ver GOLIVE.md).
- Teste de compra: usar uma conta "Sandbox tester" criada em App Store Connect → Users and Access → Sandbox.
