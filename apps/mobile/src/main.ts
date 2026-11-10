import { Capacitor } from '@capacitor/core';
import { Contacts } from '@capacitor-community/contacts';
import { PushNotifications } from '@capacitor/push-notifications';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { NativePurchases, PURCHASE_TYPE } from '@capgo/native-purchases';
import { NativeVideoCompressor } from 'capacitor-native-video-compressor';
import { SocialLogin } from '@capgo/capacitor-social-login';
import { createAppleBridge } from './apple-bridge.ts';
import { createCalendarBridge } from './calendar-bridge.ts';
import { createContactsBridge } from './contacts-bridge.ts';
import { createPushBridge, openInApp } from './push-bridge.ts';
import { createStoreBridge } from './store-bridge.ts';
import { createVideoBridge } from './video-bridge.ts';

/** Carregado antes do app web (ver scripts/build-web.mjs): o app procura estas pontes na hora de usar. */
const w = window as unknown as Record<string, unknown>;

function toBase64(chunk: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Não foi possível ler o vídeo.'));
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.readAsDataURL(chunk);
  });
}

if (Capacitor.isNativePlatform()) {
  w['AskouTVideo'] = createVideoBridge({
    filesystem: {
      writeFile: (o) => Filesystem.writeFile({ path: o.path, data: o.data, directory: Directory.Cache }),
      appendFile: (o) => Filesystem.appendFile({ path: o.path, data: o.data, directory: Directory.Cache }),
      deleteFile: (o) => Filesystem.deleteFile(o.directory ? { path: o.path, directory: Directory.Cache } : { path: o.path }),
    },
    compressor: NativeVideoCompressor as never,
    convertFileSrc: (p) => Capacitor.convertFileSrc(p),
    fetchFile: async (url) => (await fetch(url)).blob(),
    toBase64,
    newId: () => crypto.randomUUID(),
  });
  w['AskouTStore'] = createStoreBridge({
    purchases: {
      purchaseProduct: (o) => NativePurchases.purchaseProduct({ ...o, productType: PURCHASE_TYPE.INAPP }),
    },
    platform: () => Capacitor.getPlatform(),
  });
  // "Adicionar à agenda": grava o .ics e abre o menu de compartilhar (iPhone e Android).
  w['AskouTCalendar'] = createCalendarBridge({
    writeFile: (o) => Filesystem.writeFile({ path: o.path, data: o.data, directory: Directory.Cache, encoding: Encoding.UTF8 }),
    share: (o) => Share.share(o),
  });
  // "Mais opções" da folha de compartilhar: abre o menu nativo do aparelho (o WebView do Android não tem navigator.share).
  w['AskouTShare'] = { share: (o: { title?: string; text?: string; url?: string; dialogTitle?: string }) => Share.share(o) };
  // "Achar nos contatos": lê celulares e e-mails da agenda (iPhone e Android), com a permissão do aparelho.
  w['AskouTContacts'] = createContactsBridge({ contacts: Contacts as never });
  if (Capacitor.getPlatform() === 'ios') {
    // O botão da Apple da web não abre dentro do app; no iPhone entra a janela nativa.
    w['AskouTApple'] = createAppleBridge({ login: SocialLogin as never });
    // Avisos fora do app: o token vai para o servidor pelo app web; tocar no aviso abre a tela certa.
    w['AskouTPush'] = createPushBridge({ push: PushNotifications as never, open: (path) => openInApp(path, window) });
  }
  void StatusBar.setStyle({ style: Style.Default }).catch(() => undefined);
  void SplashScreen.hide().catch(() => undefined);
}
