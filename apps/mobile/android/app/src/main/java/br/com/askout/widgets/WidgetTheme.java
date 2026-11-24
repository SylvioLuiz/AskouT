package br.com.askout.widgets;

import android.content.Context;
import android.widget.RemoteViews;
import br.com.askout.R;

/**
 * Tema dos widgets: o mesmo escolhido no app (Configuração › Tema e idioma, apps/web/src/lib/theme.ts), que chega pelo
 * WidgetsPlugin.setTheme e fica no WidgetData.
 *
 * - "system" (Automático): os layouts usam @color/widget_* (values e values-night), e o Android troca sozinho junto
 *   com o tema do aparelho.
 * - "light" / "dark": pinta por cima as mesmas cores, fixas, no fundo e em cada texto (RemoteViews não deixa escolher a
 *   pasta de recursos). Os detalhes translúcidos (botão contornado, bloco do dia, divisória, trilho) são cinza neutro
 *   e servem nos dois fundos.
 */
final class WidgetTheme {

    static final String SYSTEM = "system";
    static final String LIGHT = "light";
    static final String DARK = "dark";

    private static final int LIGHT_INK = 0xFF1C1C1E;
    private static final int LIGHT_MUTED = 0xFF5C5C60;
    private static final int LIGHT_PINK = 0xFFD6248F;
    private static final int DARK_INK = 0xFFF7F3FF;
    private static final int DARK_MUTED = 0xFFB5ADCF;
    private static final int DARK_PINK = 0xFFFF4FB0;

    private WidgetTheme() {}

    static boolean valid(String theme) {
        return SYSTEM.equals(theme) || LIGHT.equals(theme) || DARK.equals(theme);
    }

    /** Aplica o tema do app aos widgets desenhados; no "Automático", deixa os recursos seguirem o aparelho. */
    static RemoteViews paint(Context context, RemoteViews v) {
        String theme = WidgetData.theme(context);
        if (!LIGHT.equals(theme) && !DARK.equals(theme)) return v;
        boolean dark = DARK.equals(theme);
        v.setInt(R.id.widget_root, "setBackgroundResource", dark ? R.drawable.widget_background_dark : R.drawable.widget_background_light);
        int layout = v.getLayoutId();
        color(v, ink(layout), dark ? DARK_INK : LIGHT_INK);
        color(v, muted(layout), dark ? DARK_MUTED : LIGHT_MUTED);
        color(v, pink(layout), dark ? DARK_PINK : LIGHT_PINK);
        return v;
    }

    private static void color(RemoteViews v, int[] ids, int color) {
        for (int id : ids) v.setTextColor(id, color);
    }

    // Os textos de cada layout por papel (os mesmos @color/widget_ink, _muted e _pink do XML).

    private static int[] ink(int layout) {
        if (layout == R.layout.widget_message) return new int[] {R.id.widget_title};
        if (layout == R.layout.widget_next) return new int[] {R.id.widget_date, R.id.widget_title};
        if (layout == R.layout.widget_active) return new int[] {R.id.widget_title, R.id.widget_action_invite};
        if (layout == R.layout.widget_combo) return new int[] {R.id.widget_title, R.id.widget_action_invite, R.id.widget_count, R.id.widget_count_label};
        if (layout == R.layout.widget_agenda) return new int[] {R.id.widget_row1_title, R.id.widget_row2_title, R.id.widget_row3_title, R.id.widget_row4_title, R.id.widget_row5_title};
        if (layout == R.layout.widget_now) return new int[] {R.id.widget_count, R.id.widget_title};
        return new int[0];
    }

    private static int[] muted(int layout) {
        if (layout == R.layout.widget_message) return new int[] {R.id.widget_eyebrow, R.id.widget_subtitle};
        if (layout == R.layout.widget_next) return new int[] {R.id.widget_hour, R.id.widget_eyebrow, R.id.widget_subtitle};
        if (layout == R.layout.widget_active) return new int[] {R.id.widget_eyebrow, R.id.widget_subtitle, R.id.widget_footer};
        if (layout == R.layout.widget_combo) return new int[] {R.id.widget_eyebrow, R.id.widget_subtitle, R.id.widget_footer, R.id.widget_friends_eyebrow, R.id.widget_names};
        if (layout == R.layout.widget_agenda) return new int[] {R.id.widget_eyebrow, R.id.widget_empty, R.id.widget_row1_sub, R.id.widget_row2_sub, R.id.widget_row3_sub, R.id.widget_row4_sub, R.id.widget_row5_sub};
        if (layout == R.layout.widget_now) return new int[] {R.id.widget_eyebrow, R.id.widget_subtitle};
        return new int[0];
    }

    private static int[] pink(int layout) {
        if (layout == R.layout.widget_next) return new int[] {R.id.widget_day, R.id.widget_when};
        if (layout == R.layout.widget_combo) return new int[] {R.id.widget_invites};
        if (layout == R.layout.widget_now) return new int[] {R.id.widget_footer};
        return new int[0];
    }
}
