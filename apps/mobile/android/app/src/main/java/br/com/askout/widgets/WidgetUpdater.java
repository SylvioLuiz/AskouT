package br.com.askout.widgets;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.view.View;
import android.widget.RemoteViews;
import br.com.askout.R;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Desenha os cinco widgets do AskouT a partir do último resultado guardado e busca de novo em segundo plano.
 *
 * - Ao adicionar, a cada 30 min (updatePeriodMillis), ao entrar/sair e quando o app vai para o segundo plano: busca.
 * - Quando um plano começa ou termina (ou o NOW acaba), um alarme redesenha sem precisar buscar; com algo rolando,
 *   redesenha a cada 10 min para a barra de progresso andar.
 */
public final class WidgetUpdater {

    private static final ExecutorService IO = Executors.newSingleThreadExecutor();
    private static final long REFRESH_MS = 30 * 60_000L;
    private static final long LIVE_TICK_MS = 10 * 60_000L;
    static final String ACTION_TICK = "br.com.askout.widgets.TICK";

    private WidgetUpdater() {}

    /** Redesenha já com o que está guardado e busca de novo; `done` roda no fim (o `goAsync` do provider). */
    public static void refresh(Context context, Runnable done) {
        Context app = context.getApplicationContext();
        renderAll(app);
        IO.execute(() -> {
            try {
                WidgetData.fetch(app);
                renderAll(app);
            } finally {
                if (done != null) done.run();
            }
        });
    }

    public static void refresh(Context context) {
        refresh(context, null);
    }

    static void renderAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        boolean loggedIn = WidgetData.loggedIn(context);
        WidgetData.Snapshot s = WidgetData.cached(context);
        long now = System.currentTimeMillis();
        render(context, manager, NextMeetupWidget.class, loggedIn ? next(context, s, now) : loggedOut(context));
        render(context, manager, ActiveMeetupWidget.class, loggedIn ? active(context, s, now) : loggedOut(context));
        render(context, manager, AgendaWidget.class, loggedIn ? agenda(context, s, now) : loggedOut(context));
        render(context, manager, NowFriendsWidget.class, loggedIn ? nowFriends(context, s, now) : loggedOut(context));
        render(context, manager, NowComboWidget.class, loggedIn ? combo(context, s, now) : loggedOut(context));
        schedule(context, loggedIn ? s : null, now);
    }

    private static void render(Context context, AppWidgetManager manager, Class<?> provider, RemoteViews views) {
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, provider));
        if (ids.length > 0) manager.updateAppWidget(ids, views);
    }

    /** Próximo redesenho: na próxima troca, a cada 10 min com algo rolando, ou para buscar de novo. */
    private static void schedule(Context context, WidgetData.Snapshot s, long now) {
        if (!hasAny(context)) return;
        long at = now + REFRESH_MS;
        if (s != null) {
            long t = s.nextTransition(now);
            if (t > 0) at = Math.min(at, t + 1_000);
            if (s.activeMatch(now) != null || s.activePlan(now) != null) at = Math.min(at, now + LIVE_TICK_MS);
        }
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) return;
        Intent intent = new Intent(context, TickReceiver.class).setAction(ACTION_TICK);
        PendingIntent pending = PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        // Inexato de propósito (não pede permissão de alarme exato); o Android junta com outros e economiza bateria.
        alarms.set(AlarmManager.RTC, at, pending);
    }

    private static boolean hasAny(Context context) {
        AppWidgetManager m = AppWidgetManager.getInstance(context);
        for (Class<?> c : new Class<?>[] {NextMeetupWidget.class, ActiveMeetupWidget.class, AgendaWidget.class, NowFriendsWidget.class, NowComboWidget.class}) {
            if (m.getAppWidgetIds(new ComponentName(context, c)).length > 0) return true;
        }
        return false;
    }

    /** Alarme da próxima troca: redesenha; se a última busca é antiga, busca também. */
    public static class TickReceiver extends BroadcastReceiver {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (System.currentTimeMillis() - WidgetData.fetchedAt(context) > REFRESH_MS - 60_000) {
                PendingResult result = goAsync();
                refresh(context, result::finish);
            } else {
                renderAll(context.getApplicationContext());
            }
        }
    }

    // ---------- Toques ----------

    private static PendingIntent open(Context context, String path, int requestCode) {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("br.com.askout:/" + (path.startsWith("/") ? path : "/" + path)));
        intent.setPackage(context.getPackageName());
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    // ---------- Desenhos ----------

    private static RemoteViews loggedOut(Context context) {
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_message);
        v.setTextViewText(R.id.widget_eyebrow, "ASKOUT");
        v.setTextViewText(R.id.widget_title, "Entre no AskouT");
        v.setTextViewText(R.id.widget_subtitle, "para ver seus planos aqui");
        v.setOnClickPendingIntent(R.id.widget_root, open(context, "/agenda", 900));
        return v;
    }

    private static int percent(long start, long end, long now) {
        if (end <= start) return 100;
        return (int) Math.max(0, Math.min(100, (now - start) * 100 / (end - start)));
    }

    private static RemoteViews next(Context context, WidgetData.Snapshot s, long now) {
        WidgetData.Plan p = s.next(now);
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_next);
        if (p == null) {
            v.setTextViewText(R.id.widget_day, WidgetData.dayShort(now, now));
            v.setTextViewText(R.id.widget_date, WidgetData.dayOfMonth(now));
            v.setViewVisibility(R.id.widget_hour, View.GONE);
            v.setTextViewText(R.id.widget_when, "Nada marcado");
            v.setTextViewText(R.id.widget_title, "Confirme presença num evento ou crie um encontro");
            v.setViewVisibility(R.id.widget_subtitle, View.GONE);
            v.setOnClickPendingIntent(R.id.widget_root, open(context, "/agenda", 100));
            return v;
        }
        v.setTextViewText(R.id.widget_day, WidgetData.dayShort(p.startsAt, now));
        v.setTextViewText(R.id.widget_date, WidgetData.dayOfMonth(p.startsAt));
        v.setViewVisibility(R.id.widget_hour, View.VISIBLE);
        v.setTextViewText(R.id.widget_hour, WidgetData.hour(p.startsAt));
        v.setTextViewText(R.id.widget_when, WidgetData.when(p.startsAt, now));
        v.setTextViewText(R.id.widget_title, p.title);
        String sub = p.venueName != null ? p.venueName : "";
        if (p.people > 1) sub = sub.isEmpty() ? p.people + " confirmados" : sub + " · " + p.people + " confirmados";
        v.setViewVisibility(R.id.widget_subtitle, sub.isEmpty() ? View.GONE : View.VISIBLE);
        v.setTextViewText(R.id.widget_subtitle, sub);
        v.setOnClickPendingIntent(R.id.widget_root, open(context, p.url, 100));
        return v;
    }

    /** Pedidos que o widget faz à tela do NOW (lidos em apps/web/src/screens/flash.tsx, liberados em deep-link.ts). */
    private static final String NOW_TURN_ON = "/now?abrir=ligar";
    private static final String NOW_INVITE = "/now?abrir=convidar";

    private static RemoteViews active(Context context, WidgetData.Snapshot s, long now) {
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_active);
        fillMeetup(context, v, s, now, 200, true);
        return v;
    }

    /**
     * Lado do encontro (widget_active e widget_combo usam os mesmos ids): encontro do NOW, plano rolando ou, sem nada,
     * os atalhos para ligar o NOW (ou ver quem está livre, se já está ligado) e convidar alguém.
     */
    private static void fillMeetup(Context context, RemoteViews v, WidgetData.Snapshot s, long now, int code, boolean showNext) {
        WidgetData.NowMatch m = s.activeMatch(now);
        WidgetData.Plan p = m == null ? s.activePlan(now) : null;
        if (m != null) {
            v.setTextViewText(R.id.widget_eyebrow, "NOW AO VIVO");
            v.setViewVisibility(R.id.widget_initial, View.VISIBLE);
            v.setTextViewText(R.id.widget_initial, m.withName.isEmpty() ? "?" : m.withName.substring(0, 1).toUpperCase());
            v.setTextViewText(R.id.widget_title, "Com " + m.withName);
            v.setTextViewText(R.id.widget_subtitle, m.placeName != null ? m.placeName : "Escolham o lugar");
            v.setViewVisibility(R.id.widget_progress, View.VISIBLE);
            v.setProgressBar(R.id.widget_progress, 100, percent(m.startedAt, m.expiresAt, now), false);
            v.setViewVisibility(R.id.widget_footer, View.VISIBLE);
            v.setTextViewText(R.id.widget_footer, "até " + WidgetData.hour(m.expiresAt));
            v.setViewVisibility(R.id.widget_actions, View.GONE);
            v.setOnClickPendingIntent(R.id.widget_root, open(context, m.url, code));
        } else if (p != null) {
            v.setTextViewText(R.id.widget_eyebrow, "ROLANDO AGORA");
            v.setViewVisibility(R.id.widget_initial, View.GONE);
            v.setTextViewText(R.id.widget_title, p.title);
            v.setTextViewText(R.id.widget_subtitle, p.venueName != null ? p.venueName : (p.meetup ? "Encontro" : "Evento"));
            v.setViewVisibility(R.id.widget_progress, View.VISIBLE);
            v.setProgressBar(R.id.widget_progress, 100, percent(p.startsAt, p.endsAt, now), false);
            v.setViewVisibility(R.id.widget_footer, View.VISIBLE);
            v.setTextViewText(R.id.widget_footer, "até " + WidgetData.hour(p.endsAt));
            v.setViewVisibility(R.id.widget_actions, View.GONE);
            v.setOnClickPendingIntent(R.id.widget_root, open(context, p.url, code));
        } else {
            boolean mine = s.flashOn(now);
            WidgetData.Plan next = s.next(now);
            String line;
            if (mine) {
                line = "NOW ligado até " + WidgetData.hour(s.flashExpiresAt);
                if (showNext && s.friendsCount > 0) line += " · " + (s.friendsCount == 1 ? "1 amigo livre" : s.friendsCount + " amigos livres");
            } else {
                line = "Ligue o NOW e veja quem está livre";
            }
            if (showNext && next != null) line += " · Próximo: " + WidgetData.when(next.startsAt, now);
            else if (!mine && next != null) line = "Próximo: " + WidgetData.when(next.startsAt, now);
            v.setTextViewText(R.id.widget_eyebrow, mine ? "NOW LIGADO" : "AGORA");
            v.setViewVisibility(R.id.widget_initial, View.GONE);
            v.setTextViewText(R.id.widget_title, "Nada rolando agora");
            v.setTextViewText(R.id.widget_subtitle, line);
            v.setViewVisibility(R.id.widget_progress, View.GONE);
            v.setViewVisibility(R.id.widget_footer, View.GONE);
            v.setViewVisibility(R.id.widget_actions, View.VISIBLE);
            v.setTextViewText(R.id.widget_action_primary, mine ? "⚡ Quem está livre" : "⚡ Ligar o NOW");
            String target = mine ? "/now" : NOW_TURN_ON;
            v.setOnClickPendingIntent(R.id.widget_action_primary, open(context, target, code + 1));
            v.setOnClickPendingIntent(R.id.widget_action_invite, open(context, NOW_INVITE, code + 2));
            v.setOnClickPendingIntent(R.id.widget_root, open(context, target, code));
        }
    }

    /** "NOW": encontro à esquerda e quem está livre à direita (o toque na direita abre a lista do NOW). */
    private static RemoteViews combo(Context context, WidgetData.Snapshot s, long now) {
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_combo);
        fillMeetup(context, v, s, now, 500, false);
        int count = s.friendsCount;
        v.setTextViewText(R.id.widget_count, String.valueOf(count));
        v.setTextViewText(R.id.widget_count_label, count == 1 ? "amigo livre" : "amigos livres");
        String names = WidgetData.names(s.friendNames, count);
        v.setTextViewText(R.id.widget_names, names.isEmpty() ? "Chame alguém pelo NOW" : names);
        if (s.pendingInvites > 0) {
            v.setViewVisibility(R.id.widget_badge, View.VISIBLE);
            v.setTextViewText(R.id.widget_badge, String.valueOf(s.pendingInvites));
            v.setViewVisibility(R.id.widget_invites, View.VISIBLE);
            v.setTextViewText(R.id.widget_invites, s.pendingInvites == 1 ? "1 convite esperando" : s.pendingInvites + " convites esperando");
        } else {
            v.setViewVisibility(R.id.widget_badge, View.GONE);
            v.setViewVisibility(R.id.widget_invites, View.GONE);
        }
        v.setOnClickPendingIntent(R.id.widget_friends, open(context, "/now", 510));
        return v;
    }

    private static final int[] ROWS = {R.id.widget_row1, R.id.widget_row2, R.id.widget_row3, R.id.widget_row4, R.id.widget_row5};
    private static final int[] ROW_TITLES = {R.id.widget_row1_title, R.id.widget_row2_title, R.id.widget_row3_title, R.id.widget_row4_title, R.id.widget_row5_title};
    private static final int[] ROW_SUBS = {R.id.widget_row1_sub, R.id.widget_row2_sub, R.id.widget_row3_sub, R.id.widget_row4_sub, R.id.widget_row5_sub};
    private static final int[] ROW_BARS = {R.id.widget_row1_bar, R.id.widget_row2_bar, R.id.widget_row3_bar, R.id.widget_row4_bar, R.id.widget_row5_bar};

    private static RemoteViews agenda(Context context, WidgetData.Snapshot s, long now) {
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_agenda);
        List<WidgetData.Plan> plans = s.agenda(now, ROWS.length);
        v.setViewVisibility(R.id.widget_empty, plans.isEmpty() ? View.VISIBLE : View.GONE);
        for (int i = 0; i < ROWS.length; i++) {
            if (i >= plans.size()) {
                v.setViewVisibility(ROWS[i], View.GONE);
                continue;
            }
            WidgetData.Plan p = plans.get(i);
            v.setViewVisibility(ROWS[i], View.VISIBLE);
            v.setTextViewText(ROW_TITLES[i], p.title);
            String when = WidgetData.when(p.startsAt, now);
            v.setTextViewText(ROW_SUBS[i], p.venueName != null ? when + " · " + p.venueName : when);
            v.setInt(ROW_BARS[i], "setBackgroundResource", p.meetup ? R.drawable.widget_bar_meetup : R.drawable.widget_bar_event);
            v.setOnClickPendingIntent(ROWS[i], open(context, p.url, 300 + i));
        }
        v.setOnClickPendingIntent(R.id.widget_root, open(context, "/agenda", 310));
        return v;
    }

    private static RemoteViews nowFriends(Context context, WidgetData.Snapshot s, long now) {
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_now);
        int count = s.friendsCount;
        boolean mine = s.flashOn(now);
        v.setTextViewText(R.id.widget_count, String.valueOf(count));
        v.setTextViewText(R.id.widget_title, count == 1 ? "amigo livre agora" : "amigos livres agora");
        String names = WidgetData.names(s.friendNames, count);
        v.setViewVisibility(R.id.widget_subtitle, names.isEmpty() ? View.GONE : View.VISIBLE);
        v.setTextViewText(R.id.widget_subtitle, names);
        if (s.pendingInvites > 0) {
            v.setTextViewText(R.id.widget_footer, s.pendingInvites == 1 ? "1 convite esperando" : s.pendingInvites + " convites esperando");
        } else if (mine) {
            v.setTextViewText(R.id.widget_footer, "Seu NOW até " + WidgetData.hour(s.flashExpiresAt));
        } else {
            v.setTextViewText(R.id.widget_footer, "Ligar o meu NOW →");
        }
        v.setTextViewText(R.id.widget_eyebrow, mine ? "NOW · LIGADO" : "NOW");
        v.setOnClickPendingIntent(R.id.widget_root, open(context, "/now", 400));
        return v;
    }
}
