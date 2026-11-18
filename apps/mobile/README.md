# AskouT — casca nativa (iOS e Android)

O aplicativo é o `apps/web`, empacotado pelo [Capacitor](https://capacitorjs.com). Esta pasta só tem a casca:

- `src/main.ts` instala as pontes antes do app: `window.AskouTVideo` (compressão de vídeo nativa) e `window.AskouTStore` (compra na App Store / Google Play).
- `scripts/build-web.mjs` gera o site em `www/` apontando para a API (`VITE_API_URL`, obrigatório e em https) e injeta as pontes.
- `android/` e `ios/` são os projetos nativos (versionados; `www/` não).

```
VITE_API_URL=https://api.seudominio.com.br npm run sync
npx cap open ios        # Xcode
npx cap open android    # Android Studio
```

Detalhes e pendências em `GOLIVE.md` (seção “Aplicativo nativo”).

## Login com o Google no app

O botão oficial do Google da web não funciona dentro do app (o Google bloqueia login em WebView, e `https://localhost` / `capacitor://localhost` não são origens autorizadas). No app entra a janela nativa, pela ponte `window.AskouTGoogle` (`src/google-bridge.ts`, plugin `@capgo/capacitor-social-login`). O token sai emitido para o cliente **web** (`GOOGLE_CLIENT_ID`), então a API confere como sempre.

Tudo no **mesmo projeto** do Google Cloud do cliente web (`askout-512422`, não o projeto do Firebase), em *APIs e serviços → Credenciais → Criar credenciais → ID do cliente OAuth*:

- **Android**: pacote `br.com.askout` + SHA-1. Um cliente para cada chave que assina o app: a de upload/release (`keytool -list -v -keystore <arquivo>.jks`), a de debug (`./gradlew signingReport`) e a **Play App Signing** (Play Console → Integridade do app → Certificado da chave de assinatura). Nada vai no código.
- **iOS**: bundle `br.com.askout`. O ID vai em `GOOGLE_IOS_CLIENT_ID` na API, e o **iOS URL scheme** do cliente (`com.googleusercontent.apps.…`) vai no `ios/App/App/Info.plist`:

```xml
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLSchemes</key>
    <array><string>com.googleusercontent.apps.SEU-ID-IOS</string></array>
  </dict>
</array>
```

Sem `GOOGLE_IOS_CLIENT_ID` o iPhone não mostra o botão do Google (o SDK do Google fecha o app se o URL scheme faltar, então faça os dois juntos). No Android, falha com `[28444] Developer console is not set up correctly` = SHA-1 ou pacote não cadastrado no cliente Android (o Logcat, filtro `GoogleProvider`, mostra o SHA-1 que está assinando).

## Agenda do celular (Sincronizar agendas)

Ponte `window.AskouTDeviceCalendar` (`src/device-calendar-bridge.ts`, plugin `@ebarooni/capacitor-calendar`). Lê as agendas do aparelho (que já reúnem as contas Google, Outlook/Exchange e iCloud) e manda para a API só início e fim dos compromissos das agendas escolhidas.

- Android: `READ_CALENDAR` no `AndroidManifest.xml`.
- iPhone: `NSCalendarsFullAccessUsageDescription` e `NSCalendarsUsageDescription` no `Info.plist` (no iOS 17+ ler a agenda exige o acesso completo).
- Depois de `npm install`, rode `npm run sync` para o plugin entrar nos projetos nativos (o `CapApp-SPM/Package.swift` e o Gradle são atualizados pelo Capacitor).
