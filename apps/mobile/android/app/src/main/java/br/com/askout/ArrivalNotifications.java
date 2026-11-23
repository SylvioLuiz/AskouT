package br.com.askout;

import android.content.Context;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import java.util.Map;

/**
 * Chegada do amigo no NOW (como o carro chegando no Uber): uma notificação fixa, com barra de progresso, que o
 * servidor atualiza a cada posição nova (mesma `tag`). Só existe se o amigo liberou (apps/api FlashService.setArrival).
 *
 * Dados do push (apps/api fcm-sender.ts): live = moving | arrived | stopped, progress 0–100, quiet 0/1,
 * until (fim do encontro, ms), title, body, url, tag.
 */
final class ArrivalNotifications {

    /** Id fixo; cada amigo tem a sua `tag` (arrival:<encontro>:<pessoa>). */
    private static final int NOTIFICATION_ID = 2;

    private ArrivalNotifications() {}

    static void show(Context context, String messageId, Map<String, String> data) {
        String state = data.get("live");
        String url = value(data.get("url"), "/now");
        String tag = value(data.get("tag"), url);
        if ("stopped".equals(state)) {
            // Parou de mostrar ou o encontro acabou: o aviso fixo some.
            NotificationManagerCompat.from(context).cancel(tag, NOTIFICATION_ID);
            return;
        }
        boolean arrived = "arrived".equals(state);
        boolean quiet = "1".equals(data.get("quiet"));
        int progress = clamp(parse(data.get("progress"), 0), 0, 100);
        long until = parse(data.get("until"), 0L);
        String body = value(data.get("body"), "");

        MessageNotifications.ensureChannel(context);
        NotificationCompat.Builder builder = MessageNotifications.base(context, tag, url, messageId)
            .setContentTitle(value(data.get("title"), "AskouT"))
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setCategory(arrived ? NotificationCompat.CATEGORY_STATUS : NotificationCompat.CATEGORY_NAVIGATION)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            // Só a primeira (e a chegada) tocam; as atualizações trocam o texto e a barra em silêncio.
            .setOnlyAlertOnce(quiet)
            .setSilent(quiet)
            .setShowWhen(false);
        if (arrived) {
            builder.setOngoing(false).setAutoCancel(true).setProgress(0, 0, false);
        } else {
            builder.setOngoing(true).setAutoCancel(false).setProgress(100, progress, false);
        }
        // Some sozinha quando o encontro acaba (mesmo se o aviso de "encerrado" não chegar).
        long left = until - System.currentTimeMillis();
        if (left > 0) builder.setTimeoutAfter(arrived ? Math.min(left, 15 * 60_000L) : left);
        else if (until > 0) return;

        try {
            NotificationManagerCompat.from(context).notify(tag, NOTIFICATION_ID, builder.build());
        } catch (SecurityException ignored) {
            // Sem permissão de notificações (Android 13+): não há o que mostrar.
        }
    }

    private static String value(String v, String fallback) {
        return v == null || v.isEmpty() ? fallback : v;
    }

    private static int parse(String v, int fallback) {
        try {
            return v == null ? fallback : Integer.parseInt(v);
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    private static long parse(String v, long fallback) {
        try {
            return v == null ? fallback : Long.parseLong(v);
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    private static int clamp(int v, int min, int max) {
        return Math.max(min, Math.min(max, v));
    }
}
