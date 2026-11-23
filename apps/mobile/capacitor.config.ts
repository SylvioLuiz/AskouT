import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Casca nativa do AskouT. O aplicativo em si é o apps/web, empacotado em `www` por `npm run build:web`.
 * ATENÇÃO: o `appId` é definitivo depois de publicar nas lojas. Confirme antes do primeiro envio (ver GOLIVE.md).
 */
const config: CapacitorConfig = {
  appId: 'br.com.askout',
  appName: 'AskouT',
  webDir: 'www',
  server: {
    // Origem do app no Android: https://localhost (e capacitor://localhost no iOS). Ambas entram no CORS_ORIGINS da API.
    androidScheme: 'https',
  },
  android: {
    // Exigido pelo plugin de localização em segundo plano (chegada no NOW): com a ponte nova, o Android para de
    // entregar posições depois de ~5 min com o app em segundo plano (capacitor-community/background-geolocation#89).
    useLegacyBridge: true,
  },
  ios: {
    // Segurar um link no iPhone abria a prévia do link do sistema, que engole o "tocar e segurar" do app (menu dos cartões, capa do evento).
    allowsLinkPreview: false,
  },
  plugins: {
    SplashScreen: { launchAutoHide: true, launchShowDuration: 800 },
  },
};

export default config;
