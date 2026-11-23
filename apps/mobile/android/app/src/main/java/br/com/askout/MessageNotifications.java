package br.com.askout;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.RemoteInput;
import java.util.Map;

/** Monta as notificações de mensagem com o campo "Responder" (e a de "não foi enviada"). */
final class MessageNotifications {

    /** Mesmo canal que o app cria ao abrir (apps/mobile/src/main.ts) e que o servidor usa nos outros avisos. */
    static final String CHANNEL_ID = "notificacoes";
    static final String KEY_TEXT = "askout_reply_text";
    static final String EXTRA_TOKEN = "askout_reply_token";
    static final String EXTRA_TAG = "askout_reply_tag";
    static final String EXTRA_URL = "askout_reply_url";
    static final String EXTRA_TITLE = "askout_reply_title";
    /** Avisos de uma conversa se substituem pela `tag` (msg:<conversa>); o id é sempre o mesmo. */
    static final int NOTIFICATION_ID = 1;

    private MessageNotifications() {}

    static void show(Context context, String messageId, Map<String, String> data) {
        String title = value(data.get("title"), "AskouT");
        String body = value(data.get("body"), "");
        String url = value(data.get("url"), "/conversas");
        String tag = value(data.get("tag"), url);
        String token = data.get("reply");

        ensureChannel(context);
        NotificationCompat.Builder builder = base(context, tag, url, messageId)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body));

        if (token != null && !token.isEmpty()) {
            Intent reply = new Intent(context, ReplyReceiver.class)
                .putExtra(EXTRA_TOKEN, token)
                .putExtra(EXTRA_TAG, tag)
                .putExtra(EXTRA_URL, url)
                .putExtra(EXTRA_TITLE, title);
            // O campo de texto precisa de um PendingIntent mutável (o Android põe o texto digitado nele).
            int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0);
            PendingIntent replyIntent = PendingIntent.getBroadcast(context, ("reply:" + tag).hashCode(), reply, flags);
            RemoteInput input = new RemoteInput.Builder(KEY_TEXT).setLabel("Mensagem").build();
            NotificationCompat.Action action = new NotificationCompat.Action.Builder(icon(context), "Responder", replyIntent)
                .addRemoteInput(input)
                .setAllowGeneratedReplies(true)
                .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
                .setShowsUserInterface(false)
                .build();
            builder.addAction(action);
        }
        notify(context, tag, builder);
    }

    /** A resposta não saiu: troca a notificação por um aviso; tocar abre a conversa para tentar de novo. */
    static void showFailure(Context context, String tag, String url, String title) {
        ensureChannel(context);
        NotificationCompat.Builder builder = base(context, tag, url, null)
            .setContentTitle(value(title, "AskouT"))
            .setContentText("Sua resposta não foi enviada. Toque para abrir a conversa.")
            .setOnlyAlertOnce(true);
        notify(context, tag, builder);
    }

    static void cancel(Context context, String tag) {
        NotificationManagerCompat.from(context).cancel(tag, NOTIFICATION_ID);
    }

    /**
     * Tocar no aviso abre o app como os avisos montados pelo Firebase: com `google.message_id` e os dados no Intent,
     * o plugin do Capacitor avisa o app web ("pushNotificationActionPerformed") e ele abre o `url`.
     */
    static NotificationCompat.Builder base(Context context, String tag, String url, String messageId) {
        Intent open = new Intent(context, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra("google.message_id", messageId != null ? messageId : "reply:" + tag)
            .putExtra("url", url);
        PendingIntent openIntent = PendingIntent.getActivity(context, ("open:" + tag).hashCode(), open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        // O caminho fica no aviso: o app tira da bandeja os avisos da tela que a pessoa abriu (push-bridge.ts).
        android.os.Bundle extras = new android.os.Bundle();
        extras.putString("askout.url", url);
        return new NotificationCompat.Builder(context, CHANNEL_ID)
            .addExtras(extras)
            .setSmallIcon(icon(context))
            .setColor(androidx.core.content.ContextCompat.getColor(context, R.color.notification_accent))
            .setContentIntent(openIntent)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setDefaults(NotificationCompat.DEFAULT_ALL);
    }

    private static void notify(Context context, String tag, NotificationCompat.Builder builder) {
        try {
            NotificationManagerCompat.from(context).notify(tag, NOTIFICATION_ID, builder.build());
        } catch (SecurityException ignored) {
            // Sem permissão de notificações (Android 13+): não há o que mostrar.
        }
    }

    /** O app cria o canal ao abrir; se o push chegar antes disso (instalou e ainda não abriu), cria igual. */
    static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Notificações", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Mensagens, convites e eventos do AskouT");
        channel.setLockscreenVisibility(NotificationCompat.VISIBILITY_PRIVATE);
        channel.enableVibration(true);
        channel.enableLights(true);
        manager.createNotificationChannel(channel);
    }

    /** Ícone pequeno do aviso: silhueta branca do AskouT (o Android pinta só o contorno; o ícone colorido do app viraria um quadrado). */
    static int icon(Context context) {
        return R.drawable.ic_stat_askout;
    }

    private static String value(String v, String fallback) {
        return v == null || v.isEmpty() ? fallback : v;
    }
}
