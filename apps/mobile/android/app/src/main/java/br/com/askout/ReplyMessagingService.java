package br.com.askout;

import android.app.ActivityManager;
import androidx.annotation.NonNull;
import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

/**
 * Serviço de push do app: o mesmo do plugin do Capacitor (avisa o app web e cuida do token), e mais o "Responder".
 *
 * Mensagens de conversa chegam só com dados (title, body, url, tag, reply; ver apps/api fcm-sender.ts), porque um push
 * com "notification" o Android mostra sozinho, sem o campo de resposta. Então quem monta a notificação é o app
 * (MessageNotifications). Com o app aberto não mostra nada, como os outros avisos (o chat já aparece na tela).
 */
public class ReplyMessagingService extends MessagingService {

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);
        Map<String, String> data = remoteMessage.getData();
        // Mensagem nova: o widget de Conversas busca de novo (prévia e não lidas), mesmo com o app aberto.
        if (data.containsKey("reply")) br.com.askout.widgets.WidgetUpdater.refreshChats(this);
        // Chegada do amigo no NOW: aviso fixo que se atualiza. Aparece mesmo com o app aberto (como no Uber).
        if (remoteMessage.getNotification() == null && data.containsKey("live")) {
            ArrivalNotifications.show(this, remoteMessage.getMessageId(), data);
            return;
        }
        if (remoteMessage.getNotification() != null || !data.containsKey("reply") || !data.containsKey("title")) return;
        if (appInForeground()) return;
        MessageNotifications.show(this, remoteMessage.getMessageId(), data);
    }

    private static boolean appInForeground() {
        ActivityManager.RunningAppProcessInfo info = new ActivityManager.RunningAppProcessInfo();
        ActivityManager.getMyMemoryState(info);
        return info.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND;
    }
}
