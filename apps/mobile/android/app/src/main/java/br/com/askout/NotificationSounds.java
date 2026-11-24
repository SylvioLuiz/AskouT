package br.com.askout;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.ContentResolver;
import android.content.Context;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import androidx.core.app.NotificationCompat;

/**
 * Sons dos avisos que a pessoa escolhe no app (Configuração > Notificações).
 *
 * No Android 8+ o som é do canal, e o canal não muda depois de criado. Por isso há um canal por som: "notificacoes"
 * (som padrão do aparelho, o de sempre) e "som_<id>" para cada som do AskouT e para o "sem som". O servidor escolhe o
 * canal de cada aviso conforme a escolha da pessoa (apps/api/src/core/notification-sounds.ts, androidChannelFor).
 * Os sons ficam em res/raw (mesmos arquivos de apps/web/public/sons, usados na prévia da tela).
 */
final class NotificationSounds {

    /** Sons do AskouT: id do servidor = nome do arquivo em res/raw. */
    static final String[] CUSTOM = { "askout", "pop", "sino", "brilho" };
    static final String SILENT = "silencioso";
    static final String PREFIX = "som_";

    private NotificationSounds() {}

    /** Cria os canais que faltam (o padrão e um por som). Chamado ao abrir o app e antes de mostrar um aviso montado aqui. */
    static void ensureChannels(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        if (manager.getNotificationChannel(MessageNotifications.CHANNEL_ID) == null) {
            manager.createNotificationChannel(base(MessageNotifications.CHANNEL_ID, "Notificações", "Mensagens, convites e eventos do AskouT"));
        }
        AudioAttributes attributes = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        for (String id : CUSTOM) {
            String channelId = PREFIX + id;
            if (manager.getNotificationChannel(channelId) != null) continue;
            NotificationChannel channel = base(channelId, "Notificações: som " + label(id), "Avisos do AskouT com o som \"" + label(id) + "\"");
            channel.setSound(rawUri(context, id), attributes);
            manager.createNotificationChannel(channel);
        }
        String silentId = PREFIX + SILENT;
        if (manager.getNotificationChannel(silentId) == null) {
            NotificationChannel channel = base(silentId, "Notificações: sem som", "Avisos do AskouT que aparecem sem tocar nem vibrar");
            channel.setSound(null, null);
            channel.enableVibration(false);
            manager.createNotificationChannel(channel);
        }
    }

    /** Canal pedido pelo servidor (dados do push); só aceita os conhecidos, senão o padrão. */
    static String channelOf(String requested) {
        if (requested == null || !requested.startsWith(PREFIX)) return MessageNotifications.CHANNEL_ID;
        String id = requested.substring(PREFIX.length());
        if (SILENT.equals(id)) return requested;
        for (String known : CUSTOM) if (known.equals(id)) return requested;
        return MessageNotifications.CHANNEL_ID;
    }

    /** Põe o aviso montado pelo app no canal do som. No Android 7 (sem canais), o som vai no próprio aviso. */
    static NotificationCompat.Builder apply(Context context, NotificationCompat.Builder builder, String requested) {
        String channel = channelOf(requested);
        builder.setChannelId(channel);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O || MessageNotifications.CHANNEL_ID.equals(channel)) return builder;
        String id = channel.substring(PREFIX.length());
        if (SILENT.equals(id)) return builder.setDefaults(NotificationCompat.DEFAULT_LIGHTS).setSound(null).setVibrate(null);
        return builder.setDefaults(NotificationCompat.DEFAULT_LIGHTS | NotificationCompat.DEFAULT_VIBRATE).setSound(rawUri(context, id));
    }

    private static NotificationChannel base(String id, String name, String description) {
        NotificationChannel channel = new NotificationChannel(id, name, NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription(description);
        channel.setLockscreenVisibility(NotificationCompat.VISIBILITY_PRIVATE);
        channel.enableVibration(true);
        channel.enableLights(true);
        return channel;
    }

    private static Uri rawUri(Context context, String name) {
        // R.raw direto (e não getIdentifier): assim a redução de recursos do build não apaga os sons.
        int res;
        switch (name) {
            case "pop": res = R.raw.pop; break;
            case "sino": res = R.raw.sino; break;
            case "brilho": res = R.raw.brilho; break;
            default: res = R.raw.askout; break;
        }
        return Uri.parse(ContentResolver.SCHEME_ANDROID_RESOURCE + "://" + context.getPackageName() + "/" + res);
    }

    private static String label(String id) {
        switch (id) {
            case "askout": return "AskouT";
            case "pop": return "Pop";
            case "sino": return "Sino";
            case "brilho": return "Brilho";
            default: return id;
        }
    }
}
