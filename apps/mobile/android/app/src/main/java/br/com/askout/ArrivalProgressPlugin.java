package br.com.askout;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.service.notification.StatusBarNotification;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Barra de progresso no aviso fixo de quem mostra a chegada no NOW ("Mostrando sua chegada para…").
 *
 * O aviso é do serviço do plugin @capacitor-community/background-geolocation, que só tem título e texto. Aqui ele é
 * trocado por um igual (mesmo id e canal), com o tempo que falta e a barra, como o aviso do amigo
 * (ArrivalNotifications). O Android mantém o aviso preso ao serviço porque o id é o do serviço em primeiro plano.
 * Só troca enquanto o aviso do serviço está na tela: depois que a pessoa para, não deixa um aviso solto.
 */
@CapacitorPlugin(name = "AskouTArrivalProgress")
public class ArrivalProgressPlugin extends Plugin {

    /** Id e canal do aviso do serviço do plugin (BackgroundGeolocationService.NOTIFICATION_ID, nome do pacote). */
    static final int SERVICE_NOTIFICATION_ID = 28351;
    static final String SERVICE_CHANNEL_ID = "com.equimaps.capacitor_background_geolocation";

    @PluginMethod
    public void update(PluginCall call) {
        Context context = getContext();
        JSObject result = new JSObject();
        if (!serviceNotificationShowing(context)) {
            result.put("shown", false);
            call.resolve(result);
            return;
        }
        int progress = Math.max(0, Math.min(100, call.getInt("progress", 0)));
        boolean arrived = Boolean.TRUE.equals(call.getBoolean("arrived", false));
        String text = call.getString("text", "");
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, SERVICE_CHANNEL_ID)
            .setSmallIcon(MessageNotifications.icon(context))
            .setColor(androidx.core.content.ContextCompat.getColor(context, R.color.notification_accent))
            .setContentTitle(call.getString("title", "AskouT"))
            .setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setCategory(NotificationCompat.CATEGORY_NAVIGATION)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setShowWhen(true)
            .setWhen(System.currentTimeMillis())
            .setProgress(100, arrived ? 100 : progress, false);
        Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (launch != null) {
            launch.addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
            builder.setContentIntent(PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        }
        Notification notification = builder.build();
        notification.flags |= Notification.FLAG_FOREGROUND_SERVICE | Notification.FLAG_NO_CLEAR;
        try {
            NotificationManagerCompat.from(context).notify(SERVICE_NOTIFICATION_ID, notification);
            result.put("shown", true);
        } catch (SecurityException e) {
            // Sem permissão de notificações (Android 13+): o serviço segue, só sem aviso.
            result.put("shown", false);
        }
        call.resolve(result);
    }

    private static boolean serviceNotificationShowing(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return false;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return false;
        for (StatusBarNotification n : manager.getActiveNotifications()) {
            if (n.getId() == SERVICE_NOTIFICATION_ID && n.getTag() == null) return true;
        }
        return false;
    }
}
