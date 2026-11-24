package br.com.askout.widgets;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.BitmapShader;
import android.graphics.Canvas;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.Shader;
import android.util.Base64;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Dados do widget "Conversas": GET /me/widgets/chats?show=all|direct|group (apps/api/src/core/widget-service.ts,
 * `chats`), um resultado guardado por filtro e as fotos já recortadas em círculo (cache do app).
 *
 * A API já aplica as regras da aba Conversas: sem quem tem bloqueio com você, sem solicitações de mensagem pendentes e
 * com as mesmas prévias ("Perfil compartilhado", "Foto", "Mensagem de voz"). Cada widget guarda o próprio filtro, que a
 * pessoa escolhe ao adicionar (ChatsWidgetConfigure).
 */
final class ChatsData {

    static final String ALL = "all";
    static final String DIRECT = "direct";
    static final String GROUP = "group";
    private static final String[] SHOWS = {ALL, DIRECT, GROUP};
    private static final String KEY_CHATS = "chats_";
    private static final String KEY_SHOW = "chats_show_";
    private static final int PHOTO_PX = 96;

    private ChatsData() {}

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences("askout_widgets", Context.MODE_PRIVATE);
    }

    static boolean valid(String show) {
        return ALL.equals(show) || DIRECT.equals(show) || GROUP.equals(show);
    }

    // ---------- Filtro de cada widget ----------

    static void setShow(Context context, int widgetId, String show) {
        prefs(context).edit().putString(KEY_SHOW + widgetId, valid(show) ? show : ALL).apply();
    }

    static String show(Context context, int widgetId) {
        String show = prefs(context).getString(KEY_SHOW + widgetId, ALL);
        return valid(show) ? show : ALL;
    }

    static void forgetWidget(Context context, int widgetId) {
        prefs(context).edit().remove(KEY_SHOW + widgetId).apply();
    }

    /** Saiu da conta ou trocou de conta: apaga as conversas e as fotos guardadas (o filtro de cada widget fica). */
    static void forget(Context context) {
        SharedPreferences.Editor e = prefs(context).edit();
        for (String show : SHOWS) e.remove(KEY_CHATS + show);
        e.apply();
        File[] files = photoDir(context).listFiles();
        if (files != null) for (File f : files) f.delete();
    }

    // ---------- Busca ----------

    static Snapshot cached(Context context, String show) {
        String raw = prefs(context).getString(KEY_CHATS + show, null);
        if (raw != null) {
            try {
                return Snapshot.parse(new JSONObject(raw));
            } catch (Exception ignored) {
                // Formato antigo ou corrompido: busca de novo.
            }
        }
        return new Snapshot();
    }

    /** Busca na API (fora da thread principal) e baixa as fotos das linhas. Sem rede ou erro: fica o que estava. */
    static void fetch(Context context, String show) {
        SharedPreferences p = prefs(context);
        String token = p.getString("token", null);
        String base = p.getString("apiBase", null);
        if (token == null || base == null || !base.startsWith("https://")) return;
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(base + "/me/widgets/chats?show=" + show).openConnection();
            conn.setConnectTimeout(10_000);
            conn.setReadTimeout(10_000);
            conn.setRequestProperty("Authorization", "Bearer " + token);
            conn.setRequestProperty("Accept", "application/json");
            int status = conn.getResponseCode();
            if (status == 401) {
                // Sessão encerrada em outro lugar: o widget pede para entrar de novo.
                WidgetData.clearSession(context);
                return;
            }
            if (status != 200) return;
            String body;
            try (InputStream in = conn.getInputStream()) {
                body = new String(readAll(in), "UTF-8");
            }
            Snapshot s = Snapshot.parse(new JSONObject(body));
            if (!token.equals(p.getString("token", null))) return;
            p.edit().putString(KEY_CHATS + show, body).apply();
            for (Chat c : s.chats) if (c.photoUrl != null) savePhoto(context, c.photoUrl);
        } catch (Exception ignored) {
            // Sem internet: segue com o que estava guardado.
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static byte[] readAll(InputStream in) throws java.io.IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        return out.toByteArray();
    }

    // ---------- Fotos ----------

    private static File photoDir(Context context) {
        File dir = new File(context.getApplicationContext().getCacheDir(), "widget_chat_photos");
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    private static File photoFile(Context context, String url) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-1");
            StringBuilder hex = new StringBuilder();
            for (byte b : md.digest(url.getBytes("UTF-8"))) hex.append(String.format(Locale.US, "%02x", b));
            return new File(photoDir(context), hex + ".png");
        } catch (Exception e) {
            return new File(photoDir(context), Integer.toHexString(url.hashCode()) + ".png");
        }
    }

    /** Foto já recortada em círculo (para o RemoteViews); nula se ainda não baixou ou não deu para baixar. */
    static Bitmap photo(Context context, String url) {
        if (url == null) return null;
        File f = photoFile(context, url);
        return f.exists() ? BitmapFactory.decodeFile(f.getAbsolutePath()) : null;
    }

    private static void savePhoto(Context context, String url) {
        File f = photoFile(context, url);
        if (f.exists()) return;
        try {
            byte[] bytes;
            if (url.startsWith("data:image/")) {
                int comma = url.indexOf(',');
                if (comma < 0) return;
                bytes = Base64.decode(url.substring(comma + 1), Base64.DEFAULT);
            } else if (url.startsWith("https://")) {
                HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(8_000);
                conn.setReadTimeout(8_000);
                try (InputStream in = conn.getInputStream()) {
                    bytes = readAll(in);
                } finally {
                    conn.disconnect();
                }
            } else {
                return;
            }
            Bitmap src = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            if (src == null) return;
            Bitmap round = circle(src);
            try (FileOutputStream out = new FileOutputStream(f)) {
                round.compress(Bitmap.CompressFormat.PNG, 100, out);
            }
        } catch (Exception ignored) {
            // Fica com as iniciais.
        }
    }

    private static Bitmap circle(Bitmap src) {
        Bitmap out = Bitmap.createBitmap(PHOTO_PX, PHOTO_PX, Bitmap.Config.ARGB_8888);
        float scale = Math.max((float) PHOTO_PX / src.getWidth(), (float) PHOTO_PX / src.getHeight());
        Matrix m = new Matrix();
        m.setScale(scale, scale);
        m.postTranslate((PHOTO_PX - src.getWidth() * scale) / 2f, (PHOTO_PX - src.getHeight() * scale) / 2f);
        BitmapShader shader = new BitmapShader(src, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP);
        shader.setLocalMatrix(m);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
        paint.setShader(shader);
        new Canvas(out).drawCircle(PHOTO_PX / 2f, PHOTO_PX / 2f, PHOTO_PX / 2f, paint);
        return out;
    }

    // ---------- Modelo ----------

    static final class Chat {
        final String id;
        final boolean group;
        final String title;
        final String initials;
        final String photoUrl;
        final String preview;
        final long at;
        final int unread;
        final boolean muted;
        final boolean pinned;
        final String url;

        Chat(JSONObject o) {
            id = o.optString("id");
            group = "GROUP".equals(o.optString("type"));
            title = o.optString("title");
            initials = o.optString("initials", "?");
            photoUrl = o.isNull("photoUrl") ? null : o.optString("photoUrl", null);
            preview = o.optString("preview");
            at = o.isNull("at") ? 0 : WidgetData.parseDate(o.optString("at"));
            unread = o.optInt("unread");
            muted = o.optBoolean("muted");
            pinned = o.optBoolean("pinned");
            url = o.optString("url", "/conversas");
        }
    }

    static final class Snapshot {
        int unreadChats;
        final List<Chat> chats = new ArrayList<>();

        static Snapshot parse(JSONObject o) {
            Snapshot s = new Snapshot();
            s.unreadChats = o.optInt("unreadChats");
            JSONArray chats = o.optJSONArray("chats");
            if (chats != null) for (int i = 0; i < chats.length(); i++) s.chats.add(new Chat(chats.optJSONObject(i)));
            return s;
        }
    }

    // ---------- Textos ----------

    private static final Locale PT = new Locale("pt", "BR");

    static String title(String show) {
        if (DIRECT.equals(show)) return "INDIVIDUAIS";
        if (GROUP.equals(show)) return "GRUPOS";
        return "CONVERSAS";
    }

    static String empty(String show) {
        if (DIRECT.equals(show)) return "Nenhuma conversa individual.\nToque para abrir Conversas.";
        if (GROUP.equals(show)) return "Nenhum grupo ainda.\nToque para abrir Conversas.";
        return "Nenhuma conversa ainda.\nToque para abrir Conversas.";
    }

    static String count(int n) {
        return n > 99 ? "99+" : String.valueOf(n);
    }

    /** Como a lista de conversas do app: hoje "14:05", ontem "Ontem", na semana "seg", depois "25/10". */
    static String time(long at, long now) {
        if (at <= 0) return "";
        Calendar a = Calendar.getInstance();
        a.setTimeInMillis(at);
        Calendar b = Calendar.getInstance();
        b.setTimeInMillis(now);
        for (Calendar c : new Calendar[] {a, b}) {
            c.set(Calendar.HOUR_OF_DAY, 12);
            c.set(Calendar.MINUTE, 0);
            c.set(Calendar.SECOND, 0);
            c.set(Calendar.MILLISECOND, 0);
        }
        int days = (int) Math.round((b.getTimeInMillis() - a.getTimeInMillis()) / 86_400_000.0);
        java.util.Date d = new java.util.Date(at);
        if (days <= 0) return new SimpleDateFormat("HH:mm", PT).format(d);
        if (days == 1) return "Ontem";
        if (days < 7) return new SimpleDateFormat("EEE", PT).format(d).replace(".", "");
        return new SimpleDateFormat("dd/MM", PT).format(d);
    }
}
