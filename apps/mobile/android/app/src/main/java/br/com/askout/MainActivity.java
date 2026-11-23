package br.com.askout;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugins do próprio app (antes do super, que monta a ponte com o WebView).
        registerPlugin(ArrivalProgressPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
