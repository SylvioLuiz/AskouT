package br.com.askout;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import androidx.core.app.RemoteInput;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

/**
 * Recebe o texto do "Responder" da notificação e manda para a API (`/notifications/push/reply`, com o token que veio
 * no push), sem abrir o app. O endereço da API vem de public/askout-native.json, gerado no build
 * (apps/mobile/scripts/build-web.mjs). Deu certo: some a notificação. Não deu: avisa, e tocar abre a conversa.
 */
public class ReplyReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        Bundle results = RemoteInput.getResultsFromIntent(intent);
        CharSequence typed = results == null ? null : results.getCharSequence(MessageNotifications.KEY_TEXT);
        String text = typed == null ? "" : typed.toString().trim();
        String token = intent.getStringExtra(MessageNotifications.EXTRA_TOKEN);
        String tag = intent.getStringExtra(MessageNotifications.EXTRA_TAG);
        String url = intent.getStringExtra(MessageNotifications.EXTRA_URL);
        String title = intent.getStringExtra(MessageNotifications.EXTRA_TITLE);
        if (tag == null) return;
        if (text.isEmpty()) {
            MessageNotifications.cancel(context, tag);
            return;
        }
        Context app = context.getApplicationContext();
        // A rede não pode rodar aqui (thread principal): segura o receptor vivo até a resposta sair.
        PendingResult pending = goAsync();
        new Thread(() -> {
            try {
                if (send(app, token, text)) MessageNotifications.cancel(app, tag);
                else MessageNotifications.showFailure(app, tag, url, title);
            } finally {
                pending.finish();
            }
        }, "askout-reply").start();
    }

    private static boolean send(Context context, String token, String text) {
        if (token == null || token.isEmpty()) return false;
        HttpURLConnection connection = null;
        try {
            String base = apiUrl(context);
            if (base == null) return false;
            connection = (HttpURLConnection) new URL(base + "/notifications/push/reply").openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(15000);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            byte[] body = new JSONObject().put("token", token).put("body", text).toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream out = connection.getOutputStream()) {
                out.write(body);
            }
            int status = connection.getResponseCode();
            return status >= 200 && status < 300;
        } catch (Exception e) {
            return false;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static String apiUrl(Context context) {
        try (InputStream in = context.getAssets().open("public/askout-native.json")) {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[1024];
            int n;
            while ((n = in.read(chunk)) != -1) buffer.write(chunk, 0, n);
            String url = new JSONObject(buffer.toString("UTF-8")).optString("apiUrl", "");
            return url.startsWith("https://") ? url : null;
        } catch (Exception e) {
            return null;
        }
    }
}
