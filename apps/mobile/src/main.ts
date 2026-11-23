import { App } from '@capacitor/app';
import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core';
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
import { createLocationBridge, useNativeGeolocation } from './location-bridge.ts';
import { createBackgroundLocationBridge, type ArrivalProgressPluginLike, type BackgroundPluginLike } from './background-location-bridge.ts';
import { createGoogleBridge } from './google-bridge.ts';
import { createCalendarBridge } from './calendar-bridge.ts';
import { createFilesBridge } from './files-bridge.ts';
import { createDeviceCalendarBridge } from './device-calendar-bridge.ts';
import { createContactsBridge } from './contacts-bridge.ts';
import { createPushBridge, openInApp, type LiveActivityPluginLike } from './push-bridge.ts';
import { createStoreBridge } from './store-bridge.ts';
import { createVideoBridge } from './video-bridge.ts';
import { createGalleryBridge, type GalleryPluginLike } from './gallery-bridge.ts';
import { createAudioBridge, type AudioPluginLike } from './audio-bridge.ts';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

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
  // Link do convite (https://askout.com.br/convite/usuario, ou br.com.askout://convite/usuario no Android): abre o cadastro.
  void App.addListener('appUrlOpen', ({ url }) => {
    const path = deepLinkPath(url);
    if (path) openInApp(path, window);
  });
  const location = createLocationBridge({
    checkPermissions: () => Geolocation.checkPermissions(),
    requestPermissions: () => Geolocation.requestPermissions(),
  });
  w['AskouTLocation'] = location;
  // Chegada no NOW com o celular bloqueado (só liga quando a pessoa escolhe mostrar a chegada).
  // No Android o aviso fixo ganha a barra de quanto falta (plugin do app; build antigo sem ele segue só com o texto).
  w['AskouTBackgroundLocation'] = createBackgroundLocationBridge({
    plugin: registerPlugin<BackgroundPluginLike>('BackgroundGeolocation'),
    http: CapacitorHttp,
    progress:
      Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('AskouTArrivalProgress')
        ? registerPlugin<ArrivalProgressPluginLike>('AskouTArrivalProgress')
        : undefined,
  });
  // O WebView do Android não mostra o pedido de localização sozinho: toda leitura de posição pede antes pelo sistema.
  // A posição vem do GPS nativo (plugin), não do WebView: no Android o WebView às vezes não responde (ver location-bridge.ts).
  if (typeof navigator !== 'undefined' && navigator.geolocation) useNativeGeolocation(navigator.geolocation, Geolocation as never, () => location.ensure());
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
  // "Adicionar à agenda": abre a tela nativa de novo evento (iPhone e Android); plano B: .ics pelo menu de compartilhar.
  w['AskouTCalendar'] = createCalendarBridge({
    calendar: CapacitorCalendar as never,
    writeFile: (o) => Filesystem.writeFile({ path: o.path, data: o.data, directory: Directory.Cache, encoding: Encoding.UTF8 }),
    share: (o) => Share.share(o),
  });
  // "Sincronizar agendas": lê as agendas do aparelho (Google, Outlook, iCloud ligados no celular), só horários ocupados.
  w['AskouTDeviceCalendar'] = createDeviceCalendarBridge({ calendar: CapacitorCalendar as never, platform: () => Capacitor.getPlatform() });
  // "Baixar foto" (álbum do evento, posts): grava no cache e abre o menu do aparelho, que tem "Salvar imagem".
  w['AskouTFiles'] = createFilesBridge({
    writeFile: (o) => Filesystem.writeFile({ path: o.path, data: o.data, directory: Directory.Cache }),
    share: (o) => Share.share(o),
  });
  // "Mais opções" da folha de compartilhar: abre o menu nativo do aparelho (o WebView do Android não tem navigator.share).
  w['AskouTShare'] = { share: (o: { title?: string; text?: string; url?: string; dialogTitle?: string }) => Share.share(o) };
  // "Achar nos contatos": lê celulares e e-mails da agenda (iPhone e Android), com a permissão do aparelho.
  w['AskouTContacts'] = createContactsBridge({ contacts: Contacts as never });
  // O botão do Google da web não abre dentro do app (o Google bloqueia login em WebView): entra a janela nativa.
  w['AskouTGoogle'] = createGoogleBridge({ login: SocialLogin as never, platform: () => Capacitor.getPlatform() });
  // iPhone: a folha de compartilhar (Share Extension) envia direto, com a sessão que o app guarda no Keychain
  // compartilhado (ShareSessionPlugin.swift). O app web chama set/clear (apps/web/src/lib/share-session.ts).
  if (Capacitor.isPluginAvailable('AskouTShareSession')) {
    w['AskouTShareSession'] = registerPlugin<{ set(o: { token: string; apiBase: string }): Promise<void>; clear(): Promise<void> }>('AskouTShareSession');
  }
  // "Compartilhar com o AskouT" vindo de outro app (Android; ShareInPlugin.java). No iPhone a extensão envia sozinha. O app web abre
  // "Enviar para…" (apps/web/src/lib/share-in.ts). Build antigo, sem o plugin: a ponte não existe.
  if (Capacitor.isPluginAvailable('AskouTShareIn')) {
    const shareIn = registerPlugin<{
      take(): Promise<{ share: { items: { path: string; name: string; mime: string }[]; text?: string } | null }>;
      addListener(event: 'received', cb: () => void): Promise<{ remove(): Promise<void> }>;
    }>('AskouTShareIn');
    w['AskouTShareIn'] = {
      take: async () => (await shareIn.take()).share ?? null,
      onShare(cb: () => void): () => void {
        const handle = shareIn.addListener('received', cb);
        return () => {
          void handle.then((h) => h.remove()).catch(() => undefined);
        };
      },
    };
  }
  // Vibração curta de confirmação (arrastar para responder, segurar, etc.): no iPhone o navigator.vibrate não existe.
  // Contrato do lado web: apps/web/src/lib/haptics.ts. Build antigo, sem o plugin: o web cai no navigator.vibrate.
  if (Capacitor.isPluginAvailable('Haptics')) {
    w['AskouTHaptics'] = {
      play: (kind: 'tick' | 'tap' | 'success') =>
        kind === 'success' ? Haptics.notification({ type: NotificationType.Success }) : kind === 'tick' ? Haptics.selectionChanged() : Haptics.impact({ style: ImpactStyle.Light }),
    };
  }
  // Mensagens de voz: no iPhone tocam pelo plugin do app (AudioPlugin.swift), fora do "Tocando agora".
  // Build antigo, sem o plugin: a ponte não existe e o app web toca como antes.
  if (Capacitor.getPlatform() === 'ios' && Capacitor.isPluginAvailable('AskouTAudio')) {
    w['AskouTAudio'] = createAudioBridge(registerPlugin<AudioPluginLike>('AskouTAudio'));
  }
  // Criar story: grade da galeria dentro do app, como no Instagram. Só no iPhone (plugin do próprio app, GalleryPlugin.swift);
  // no Android segue o seletor do sistema (política do Google Play para fotos e vídeos).
  if (Capacitor.getPlatform() === 'ios' && Capacitor.isPluginAvailable('AskouTGallery')) {
    w['AskouTGallery'] = createGalleryBridge({
      plugin: registerPlugin<GalleryPluginLike>('AskouTGallery'),
      convertFileSrc: (p) => Capacitor.convertFileSrc(p),
      fetchFile: async (url) => (await fetch(url)).blob(),
      pixelRatio: () => window.devicePixelRatio || 2,
    });
  }
  if (Capacitor.getPlatform() === 'ios') {
    // O botão da Apple da web não abre dentro do app; no iPhone entra a janela nativa.
    w['AskouTApple'] = createAppleBridge({ login: SocialLogin as never });
  }
  // Avisos fora do app (iPhone pela Apple, Android pelo FCM): o token vai para o servidor pelo app web
  // (`apns:` ou `fcm:`); tocar no aviso abre a tela certa.
  // No iPhone, o token da Live Activity da chegada ao vivo (build antigo sem o plugin: segue só com o aviso comum).
  const liveActivity =
    Capacitor.getPlatform() === 'ios' && Capacitor.isPluginAvailable('AskouTLiveActivity') ? registerPlugin<LiveActivityPluginLike>('AskouTLiveActivity') : undefined;
  w['AskouTPush'] = createPushBridge({ push: PushNotifications as never, open: (path) => openInApp(path, window), liveActivity });
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
