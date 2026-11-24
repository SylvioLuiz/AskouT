package br.com.askout.widgets;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;

/** Widget "NOW": encontro e quem está livre juntos (desenho em WidgetUpdater; dados em WidgetData). */
public class NowComboWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        PendingResult result = goAsync();
        WidgetUpdater.refresh(context, result::finish);
    }
}
