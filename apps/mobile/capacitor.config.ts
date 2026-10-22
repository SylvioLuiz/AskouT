import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Casca nativa do AskouT. O aplicativo em si é o apps/web, empacotado em `www` por `npm run build:web`.
 * ATENÇÃO: o `appId` é definitivo depois de publicar nas lojas. Confirme antes do primeiro envio (ver GOLIVE.md).
 */
const config: CapacitorConfig = {
  appId: 'br.com.askout.app',
  appName: 'AskouT',
  webDir: 'www',
  server: {
    // Origem do app no Android: https://localhost (e capacitor://localhost no iOS). Ambas entram no CORS_ORIGINS da API.
    androidScheme: 'https',
  },
  plugins: {
    SplashScreen: { launchAutoHide: true, launchShowDuration: 800 },
  },
};

export default config;
