package br.com.askout;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugins do próprio app (antes do super, que monta a ponte com o WebView).
        registerPlugin(ArrivalProgressPlugin.class);
        registerPlugin(ShareInPlugin.class);
        // Widgets da tela inicial: sessão para o widget e "busque de novo" quando o app vai para o segundo plano.
        registerPlugin(br.com.askout.widgets.WidgetsPlugin.class);
        super.onCreate(savedInstanceState);
        // Aberto por "Compartilhar" de outro app: guarda os arquivos para a tela "Enviar para…".
        if (savedInstanceState == null) ShareInPlugin.receive(this, getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        // Compartilhamento novo com o app já aberto (launchMode singleTask).
        ShareInPlugin.receive(this, intent);
    }
}
