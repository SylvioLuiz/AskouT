import { useEffect } from 'react';
import { api } from '../client.ts';
import { autoAskNativePush, nativePushBridge } from '../lib/push.ts';

/**
 * No app (iPhone e Android), pede a permissão de avisos uma vez, pouco depois de a pessoa entrar (sem tela própria: é o pedido
 * do sistema). Com a permissão já dada, registra ou atualiza o token do aparelho no servidor a cada abertura.
 * No navegador não faz nada: lá o botão "Ativar avisos" continua sendo o único caminho.
 */
export function PushAutoAsk() {
  useEffect(() => {
    const bridge = nativePushBridge();
    if (!bridge) return;
    const timer = setTimeout(() => {
      void api
        .pushKey()
        .then((res) => autoAskNativePush(api, bridge, res.native === true))
        .catch(() => undefined);
    }, 2500);
    return () => clearTimeout(timer);
  }, []);
  return null;
}
