package br.com.askout.widgets;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;

/** Widget "Próximo encontro" (desenho em WidgetUpdater; dados em WidgetData). */
public class NextMeetupWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        PendingResult result = goAsync();
        WidgetUpdater.refresh(context, result::finish);
    }
}
