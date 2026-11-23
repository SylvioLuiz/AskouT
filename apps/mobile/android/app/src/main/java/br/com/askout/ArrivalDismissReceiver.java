package br.com.askout;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Botão "Ocultar" do aviso fixo da chegada do amigo: tira o aviso e deixa de mostrar as atualizações dessa chegada
 * (só a chegada em si ainda avisa). O amigo continua mostrando; quem ocultou acompanha pelo app.
 */
public class ArrivalDismissReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        String tag = intent.getStringExtra(ArrivalNotifications.EXTRA_TAG);
        if (tag == null) return;
        ArrivalNotifications.hide(context, tag);
    }
}
