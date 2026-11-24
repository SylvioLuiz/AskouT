package br.com.askout.widgets;

import android.content.Context;
import android.content.SharedPreferences;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
import java.util.TreeSet;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Dados dos widgets: a sessão que o app grava (WidgetsPlugin), a busca em GET /me/widgets
 * (apps/api/src/core/widget-service.ts) e o último resultado guardado, para mostrar algo sem internet.
 *
 * Como no iPhone (AskouTWidgets/WidgetData.swift), o widget escolhe sozinho o "encontro ativo" e o "próximo" para
 * cada instante, a partir da lista de planos: entre uma busca e outra ele continua certo.
 */
public final class WidgetData {

    private static final String PREFS = "askout_widgets";
    private static final String KEY_TOKEN = "token";
    private static final String KEY_BASE = "apiBase";
    private static final String KEY_SNAPSHOT = "snapshot";
    private static final String KEY_FETCHED = "fetchedAt";

    private WidgetData() {}

    // ---------- Sessão ----------

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static void setSession(Context context, String token, String apiBase) {
        String base = apiBase.endsWith("/") ? apiBase.substring(0, apiBase.length() - 1) : apiBase;
        SharedPreferences p = prefs(context);
        boolean changed = !token.equals(p.getString(KEY_TOKEN, null));
        SharedPreferences.Editor e = p.edit().putString(KEY_TOKEN, token).putString(KEY_BASE, base);
        // Outra conta: o resultado guardado era de outra pessoa.
        if (changed) e.remove(KEY_SNAPSHOT).remove(KEY_FETCHED);
        e.apply();
    }

    public static void clearSession(Context context) {
        prefs(context).edit().clear().apply();
    }

    static boolean loggedIn(Context context) {
        return prefs(context).getString(KEY_TOKEN, null) != null;
    }

    static long fetchedAt(Context context) {
        return prefs(context).getLong(KEY_FETCHED, 0);
    }

    /** Último resultado guardado; vazio (sem planos) se ainda não buscou. */
    static Snapshot cached(Context context) {
        String raw = prefs(context).getString(KEY_SNAPSHOT, null);
        if (raw != null) {
            try {
                return Snapshot.parse(new JSONObject(raw));
            } catch (Exception ignored) {
                // Formato antigo ou corrompido: busca de novo.
            }
        }
        return Snapshot.empty();
    }

    /** Busca na API (fora da thread principal). Sem login, 401 ou erro: fica o que estava guardado. */
    static void fetch(Context context) {
        SharedPreferences p = prefs(context);
        String token = p.getString(KEY_TOKEN, null);
        String base = p.getString(KEY_BASE, null);
        if (token == null || base == null || !base.startsWith("https://")) return;
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(base + "/me/widgets").openConnection();
            conn.setConnectTimeout(10_000);
            conn.setReadTimeout(10_000);
            conn.setRequestProperty("Authorization", "Bearer " + token);
            conn.setRequestProperty("Accept", "application/json");
            int status = conn.getResponseCode();
            if (status == 401) {
                // Sessão encerrada em outro lugar: o widget pede para entrar de novo.
                clearSession(context);
                return;
            }
            if (status != 200) return;
            String body;
            try (InputStream in = conn.getInputStream()) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                body = out.toString("UTF-8");
            }
            Snapshot.parse(new JSONObject(body));
            // Só grava se a conta não mudou no meio da busca.
            if (token.equals(p.getString(KEY_TOKEN, null))) {
                p.edit().putString(KEY_SNAPSHOT, body).putLong(KEY_FETCHED, System.currentTimeMillis()).apply();
            }
        } catch (Exception ignored) {
            // Sem internet: segue com o que estava guardado.
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    // ---------- Modelo ----------

    static long parseDate(String raw) {
        if (raw == null || raw.isEmpty() || "null".equals(raw)) return 0;
        String[] patterns = {"yyyy-MM-dd'T'HH:mm:ss.SSSX", "yyyy-MM-dd'T'HH:mm:ssX"};
        for (String pattern : patterns) {
            SimpleDateFormat f = new SimpleDateFormat(pattern, Locale.US);
            f.setTimeZone(TimeZone.getTimeZone("UTC"));
            try {
                java.util.Date d = f.parse(raw);
                if (d != null) return d.getTime();
            } catch (ParseException ignored) {
                // tenta o próximo
            }
        }
        return 0;
    }

    static final class Plan {
        final String key;
        final boolean meetup;
        final String title;
        final long startsAt;
        final long endsAt;
        final String venueName;
        final String url;
        final int people;

        Plan(JSONObject o) {
            key = o.optString("key");
            meetup = "MEETUP".equals(o.optString("kind"));
            title = o.optString("title");
            startsAt = parseDate(o.optString("startsAt"));
            endsAt = parseDate(o.optString("endsAt"));
            venueName = o.isNull("venueName") ? null : o.optString("venueName");
            url = o.optString("url", "/agenda");
            people = o.isNull("people") ? 0 : o.optInt("people", 0);
        }
    }

    static final class NowMatch {
        final String withName;
        final long startedAt;
        final long expiresAt;
        final String placeName;
        final String url;

        NowMatch(JSONObject o) {
            withName = o.optString("withName");
            startedAt = parseDate(o.optString("startedAt"));
            expiresAt = parseDate(o.optString("expiresAt"));
            placeName = o.isNull("placeName") ? null : o.optString("placeName");
            url = o.optString("url", "/now");
        }
    }

    static final class Snapshot {
        final List<Plan> plans = new ArrayList<>();
        final List<NowMatch> matches = new ArrayList<>();
        boolean flashOn;
        long flashExpiresAt;
        int friendsCount;
        final List<String> friendNames = new ArrayList<>();
        int pendingInvites;

        static Snapshot empty() {
            return new Snapshot();
        }

        static Snapshot parse(JSONObject o) {
            Snapshot s = new Snapshot();
            JSONArray plans = o.optJSONArray("plans");
            if (plans != null) for (int i = 0; i < plans.length(); i++) s.plans.add(new Plan(plans.optJSONObject(i)));
            JSONArray matches = o.optJSONArray("matches");
            if (matches != null) for (int i = 0; i < matches.length(); i++) s.matches.add(new NowMatch(matches.optJSONObject(i)));
            JSONObject flash = o.optJSONObject("flash");
            if (flash != null) {
                s.flashOn = flash.optBoolean("on");
                s.flashExpiresAt = flash.isNull("expiresAt") ? 0 : parseDate(flash.optString("expiresAt"));
            }
            JSONObject friends = o.optJSONObject("friendsOnNow");
            if (friends != null) {
                s.friendsCount = friends.optInt("count");
                JSONArray people = friends.optJSONArray("people");
                if (people != null) for (int i = 0; i < people.length(); i++) s.friendNames.add(people.optJSONObject(i).optString("name"));
            }
            s.pendingInvites = o.optInt("pendingInvites");
            Collections.sort(s.plans, (a, b) -> Long.compare(a.startsAt, b.startsAt));
            return s;
        }

        /** Encontro do NOW em andamento (tem prioridade: é agora mesmo). */
        NowMatch activeMatch(long now) {
            for (NowMatch m : matches) if (m.expiresAt > now) return m;
            return null;
        }

        /** Plano que já começou e não terminou. */
        Plan activePlan(long now) {
            for (Plan p : plans) if (p.startsAt <= now && p.endsAt > now) return p;
            return null;
        }

        Plan next(long now) {
            for (Plan p : plans) if (p.startsAt > now) return p;
            return null;
        }

        List<Plan> agenda(long now, int limit) {
            List<Plan> out = new ArrayList<>();
            for (Plan p : plans) {
                if (p.endsAt > now) out.add(p);
                if (out.size() == limit) break;
            }
            return out;
        }

        boolean flashOn(long now) {
            return flashOn && (flashExpiresAt == 0 || flashExpiresAt > now);
        }

        /** Próximo instante em que algum widget muda sozinho; 0 se nenhum. */
        long nextTransition(long now) {
            TreeSet<Long> t = new TreeSet<>();
            for (Plan p : plans) {
                t.add(p.startsAt);
                t.add(p.endsAt);
            }
            for (NowMatch m : matches) t.add(m.expiresAt);
            if (flashExpiresAt > 0) t.add(flashExpiresAt);
            Long next = t.higher(now);
            return next == null ? 0 : next;
        }
    }

    // ---------- Textos ----------

    private static String hm(long at) {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(at);
        int h = c.get(Calendar.HOUR_OF_DAY);
        int m = c.get(Calendar.MINUTE);
        return m == 0 ? h + "h" : String.format(Locale.US, "%dh%02d", h, m);
    }

    static String hour(long at) {
        return hm(at);
    }

    private static int daysBetween(long from, long to) {
        Calendar a = Calendar.getInstance();
        a.setTimeInMillis(from);
        Calendar b = Calendar.getInstance();
        b.setTimeInMillis(to);
        for (Calendar c : new Calendar[] {a, b}) {
            c.set(Calendar.HOUR_OF_DAY, 12);
            c.set(Calendar.MINUTE, 0);
            c.set(Calendar.SECOND, 0);
            c.set(Calendar.MILLISECOND, 0);
        }
        return (int) Math.round((b.getTimeInMillis() - a.getTimeInMillis()) / 86_400_000.0);
    }

    private static final Locale PT = new Locale("pt", "BR");

    /** "Agora", "Hoje 20h", "Amanhã 20h30", "sáb 20h" (na semana) ou "25/10 20h", como a agenda do app. */
    static String when(long start, long now) {
        if (start <= now) return "Agora";
        int days = daysBetween(now, start);
        if (days == 0) return "Hoje " + hm(start);
        if (days == 1) return "Amanhã " + hm(start);
        if (days < 7) return new SimpleDateFormat("EEE", PT).format(new java.util.Date(start)).replace(".", "") + " " + hm(start);
        return new SimpleDateFormat("dd/MM", PT).format(new java.util.Date(start)) + " " + hm(start);
    }

    /** "HOJE", "AMANHÃ", "SÁB" (bloco do dia). */
    static String dayShort(long at, long now) {
        int days = daysBetween(now, at);
        if (days <= 0) return "HOJE";
        if (days == 1) return "AMANHÃ";
        return new SimpleDateFormat("EEE", PT).format(new java.util.Date(at)).replace(".", "").toUpperCase(PT);
    }

    static String dayOfMonth(long at) {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(at);
        return String.valueOf(c.get(Calendar.DAY_OF_MONTH));
    }

    /** "Ana, Caio e mais 2". */
    static String names(List<String> names, int total) {
        int shown = Math.min(2, names.size());
        if (shown == 0) return "";
        int rest = total - shown;
        if (rest <= 0) return shown == 1 ? names.get(0) : names.get(0) + " e " + names.get(1);
        return (shown == 1 ? names.get(0) : names.get(0) + ", " + names.get(1)) + " e mais " + rest;
    }
}
