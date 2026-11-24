package br.com.askout.widgets;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;

/** Widget "Conversas" (desenho em WidgetUpdater; dados em ChatsData; filtro escolhido em ChatsWidgetConfigure). */
public class ChatsWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        PendingResult result = goAsync();
        WidgetUpdater.refresh(context, result::finish);
    }

    @Override
    public void onDeleted(Context context, int[] ids) {
        for (int id : ids) ChatsData.forgetWidget(context, id);
    }
}
