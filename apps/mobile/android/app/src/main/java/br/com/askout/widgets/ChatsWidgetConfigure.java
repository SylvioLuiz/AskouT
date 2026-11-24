package br.com.askout.widgets;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.Intent;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.TextView;

/**
 * Aparece ao adicionar o widget "Conversas" (e ao reconfigurar, segurando o widget no Android 12+): a pessoa escolhe se
 * ele mostra tudo, só grupos ou só conversas individuais.
 */
public class ChatsWidgetConfigure extends Activity {

    private static final String[][] OPTIONS = {
        {ChatsData.ALL, "Tudo"},
        {ChatsData.GROUP, "Só grupos"},
        {ChatsData.DIRECT, "Só individuais"},
    };

    private int widgetId = AppWidgetManager.INVALID_APPWIDGET_ID;

    private int dp(int value) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value, getResources().getDisplayMetrics());
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Voltar sem escolher cancela a inclusão do widget.
        setResult(RESULT_CANCELED);
        Bundle extras = getIntent().getExtras();
        if (extras != null) widgetId = extras.getInt(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            finish();
            return;
        }

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(24), dp(20), dp(24), dp(12));

        TextView title = new TextView(this);
        title.setText("O que o widget mostra?");
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        title.setTypeface(title.getTypeface(), android.graphics.Typeface.BOLD);
        root.addView(title);

        TextView help = new TextView(this);
        help.setText("Suas últimas conversas com a prévia das mensagens. Dá para trocar depois segurando o widget.");
        help.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        help.setPadding(0, dp(4), 0, dp(8));
        root.addView(help);

        RadioGroup group = new RadioGroup(this);
        String current = ChatsData.show(this, widgetId);
        for (int i = 0; i < OPTIONS.length; i++) {
            RadioButton b = new RadioButton(this);
            b.setId(i + 1);
            b.setText(OPTIONS[i][1]);
            b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
            b.setPadding(dp(8), dp(10), 0, dp(10));
            group.addView(b);
            if (OPTIONS[i][0].equals(current)) group.check(b.getId());
        }
        root.addView(group);

        Button done = new Button(this);
        done.setText("Pronto");
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.gravity = Gravity.END;
        lp.topMargin = dp(8);
        done.setLayoutParams(lp);
        done.setOnClickListener(v -> {
            int checked = group.getCheckedRadioButtonId();
            String show = checked >= 1 && checked <= OPTIONS.length ? OPTIONS[checked - 1][0] : ChatsData.ALL;
            ChatsData.setShow(this, widgetId, show);
            WidgetUpdater.refresh(this);
            setResult(RESULT_OK, new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId));
            finish();
        });
        root.addView(done);

        setContentView(root);
    }
}
