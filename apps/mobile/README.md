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
