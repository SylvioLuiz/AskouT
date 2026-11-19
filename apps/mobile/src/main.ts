import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { Contacts } from '@capacitor-community/contacts';
import { PushNotifications } from '@capacitor/push-notifications';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { NativePurchases, PURCHASE_TYPE } from '@capgo/native-purchases';
import { NativeVideoCompressor } from 'capacitor-native-video-compressor';
import { SocialLogin } from '@capgo/capacitor-social-login';
import { CapacitorCalendar } from '@ebarooni/capacitor-calendar';
import { createAppleBridge } from './apple-bridge.ts';
import { installBackButton } from './back-button.ts';
import { deepLinkPath } from './deep-link.ts';
import { createLocationBridge, guardGeolocation } from './location-bridge.ts';
import { createGoogleBridge } from './google-bridge.ts';
import { createCalendarBridge } from './calendar-bridge.ts';
import { createDeviceCalendarBridge } from './device-calendar-bridge.ts';
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
  if (Capacitor.getPlatform() === 'android') {
    installBackButton({
      addListener: (event, cb) => App.addListener(event, cb),
      minimizeApp: () => App.minimizeApp(),
      goBack: () => window.history.back(),
      dispatch: () => window.dispatchEvent(new Event('askout:back', { cancelable: true })),
    });
  }
  // Volta do login da agenda no navegador (br.com.askout://agenda?agendas=google): abre a Agenda com o aviso.
  void App.addListener('appUrlOpen', ({ url }) => {
    const path = deepLinkPath(url);
    if (path) openInApp(path, window);
  });
  const location = createLocationBridge({
    checkPermissions: () => Geolocation.checkPermissions(),
    requestPermissions: () => Geolocation.requestPermissions(),
  });
  w['AskouTLocation'] = location;
  // O WebView do Android não mostra o pedido de localização sozinho: toda leitura de posição pede antes pelo sistema.
  if (typeof navigator !== 'undefined' && navigator.geolocation) guardGeolocation(navigator.geolocation, () => location.ensure());
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
  // "Sincronizar agendas": lê as agendas do aparelho (Google, Outlook, iCloud ligados no celular), só horários ocupados.
  w['AskouTDeviceCalendar'] = createDeviceCalendarBridge({ calendar: CapacitorCalendar as never, platform: () => Capacitor.getPlatform() });
  // "Mais opções" da folha de compartilhar: abre o menu nativo do aparelho (o WebView do Android não tem navigator.share).
  w['AskouTShare'] = { share: (o: { title?: string; text?: string; url?: string; dialogTitle?: string }) => Share.share(o) };
  // "Achar nos contatos": lê celulares e e-mails da agenda (iPhone e Android), com a permissão do aparelho.
  w['AskouTContacts'] = createContactsBridge({ contacts: Contacts as never });
  // O botão do Google da web não abre dentro do app (o Google bloqueia login em WebView): entra a janela nativa.
  w['AskouTGoogle'] = createGoogleBridge({ login: SocialLogin as never, platform: () => Capacitor.getPlatform() });
  if (Capacitor.getPlatform() === 'ios') {
    // O botão da Apple da web não abre dentro do app; no iPhone entra a janela nativa.
    w['AskouTApple'] = createAppleBridge({ login: SocialLogin as never });
  }
  // Avisos fora do app (iPhone pela Apple, Android pelo FCM): o token vai para o servidor pelo app web
  // (`apns:` ou `fcm:`); tocar no aviso abre a tela certa.
  w['AskouTPush'] = createPushBridge({ push: PushNotifications as never, open: (path) => openInApp(path, window) });
  if (Capacitor.getPlatform() === 'android') {
    // Canal "notificacoes" com importância alta: o Android mostra o aviso no topo da tela, com o título e o texto (a prévia).
    // Sem ele, o aviso cai no canal genérico, de importância normal, e só aparece como ícone na barra.
    // O servidor manda os avisos neste canal (FCM_CHANNEL_ID em apps/api/src/infra/push/fcm-sender.ts).
    // visibility 0 (privado): na tela bloqueada o texto da mensagem fica escondido; desbloqueado, aparece.
    // O id não pode ser reaproveitado com outra configuração (o Android guarda o canal), por isso não é mais "avisos".
    void PushNotifications.deleteChannel({ id: 'avisos' }).catch(() => undefined);
    void PushNotifications.createChannel({ id: 'notificacoes', name: 'Notificações', description: 'Mensagens, convites e eventos do AskouT', importance: 5, visibility: 0, vibration: true, lights: true }).catch(() => undefined);
  }
  void StatusBar.setStyle({ style: Style.Default }).catch(() => undefined);
  void SplashScreen.hide().catch(() => undefined);
}
