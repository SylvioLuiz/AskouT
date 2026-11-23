package br.com.askout;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.BitmapShader;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Shader;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Map;

/**
 * Chegada do amigo no NOW (como o carro chegando no Uber): uma notificação fixa, com barra de progresso, que o
 * servidor atualiza a cada posição nova (mesma `tag`). Só existe se o amigo liberou (apps/api FlashService.setArrival).
 *
 * Dados do push (apps/api fcm-sender.ts): live = moving | arrived | stopped, progress 0–100, quiet 0/1,
 * until (fim do encontro, ms), title, body, url, tag, image (foto de quem está chegando, https).
 *
 * Igual ao exemplo do site (askout.com.br): foto redonda do amigo, "agora" no topo e a barra cheia na chegada.
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
            // Hora da última atualização: o Android mostra "agora" e vai contando ("1 min"...).
            .setShowWhen(true)
            .setWhen(System.currentTimeMillis());
        Bitmap photo = photo(data.get("image"));
        if (photo != null) builder.setLargeIcon(photo);
        if (arrived) {
            // Chegou: a barra fica cheia (como no site) e o aviso deixa de ser fixo.
            builder.setOngoing(false).setAutoCancel(true).setProgress(100, 100, false);
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

    /** Última foto baixada: as atualizações (a cada ~45 s) são da mesma pessoa e não baixam de novo. */
    private static String cachedUrl;
    private static Bitmap cachedPhoto;

    /**
     * Foto redonda de quem está chegando. O aviso chega fora da tela principal (pode esperar alguns segundos); se a foto
     * não vier rápido, o aviso sai sem ela.
     */
    private static synchronized Bitmap photo(String url) {
        if (url == null || !url.startsWith("https://")) return null;
        if (url.equals(cachedUrl)) return cachedPhoto;
        Bitmap round = null;
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setConnectTimeout(4000);
            connection.setReadTimeout(4000);
            try (InputStream in = connection.getInputStream()) {
                Bitmap raw = BitmapFactory.decodeStream(in);
                if (raw != null) round = circle(raw, 192);
            }
        } catch (Exception ignored) {
            // Sem a foto: o aviso sai só com o texto e a barra.
        } finally {
            if (connection != null) connection.disconnect();
        }
        if (round != null) {
            cachedUrl = url;
            cachedPhoto = round;
        }
        return round;
    }

    private static Bitmap circle(Bitmap source, int size) {
        int side = Math.min(source.getWidth(), source.getHeight());
        Bitmap square = Bitmap.createBitmap(source, (source.getWidth() - side) / 2, (source.getHeight() - side) / 2, side, side);
        Bitmap scaled = Bitmap.createScaledBitmap(square, size, size, true);
        Bitmap out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setShader(new BitmapShader(scaled, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP));
        new Canvas(out).drawCircle(size / 2f, size / 2f, size / 2f, paint);
        return out;
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
