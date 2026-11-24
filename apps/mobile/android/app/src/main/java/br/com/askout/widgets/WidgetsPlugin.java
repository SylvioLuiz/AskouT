package br.com.askout.widgets;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Ponte do app web para os widgets da tela inicial (apps/mobile/src/main.ts).
 *
 * `set({ token, apiBase })` / `clear()`: o app chama ao entrar e ao sair (o mesmo contrato da sessão da folha de
 * compartilhar do iPhone, apps/web/src/lib/share-session.ts); o widget usa o token para buscar GET /me/widgets.
 * `reload()`: o app chama ao ir para o segundo plano, para o widget mostrar o que acabou de mudar.
 * `setTheme({ theme })`: o tema escolhido no app ("system", "light" ou "dark"); os widgets se redesenham com ele.
 */
@CapacitorPlugin(name = "AskouTWidgets")
public class WidgetsPlugin extends Plugin {

    @PluginMethod
    public void set(PluginCall call) {
        String token = call.getString("token");
        String apiBase = call.getString("apiBase");
        if (token == null || token.isEmpty() || apiBase == null || !apiBase.startsWith("http")) {
            call.reject("Sessão inválida");
            return;
        }
        WidgetData.setSession(getContext(), token, apiBase);
        WidgetUpdater.refresh(getContext());
        call.resolve();
    }

    @PluginMethod
    public void clear(PluginCall call) {
        WidgetData.clearSession(getContext());
        WidgetUpdater.refresh(getContext());
        call.resolve();
    }

    @PluginMethod
    public void setTheme(PluginCall call) {
        String theme = call.getString("theme");
        if (!WidgetTheme.valid(theme)) {
            call.reject("Tema inválido");
            return;
        }
        WidgetData.setTheme(getContext(), theme);
        WidgetUpdater.renderAll(getContext().getApplicationContext());
        call.resolve();
    }

    @PluginMethod
    public void reload(PluginCall call) {
        WidgetUpdater.refresh(getContext());
        call.resolve();
    }
}
