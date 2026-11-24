package br.com.askout.widgets;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;

/** Widget "Amigos no NOW" (desenho em WidgetUpdater; dados em WidgetData). */
public class NowFriendsWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        PendingResult result = goAsync();
        WidgetUpdater.refresh(context, result::finish);
    }
}
