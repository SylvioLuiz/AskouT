import { useEffect } from 'react';
import { requestPosition } from '../lib/position.ts';

/**
 * Pede a localização do aparelho logo depois de a pessoa entrar (já logada, já com os termos aceitos): é o pedido do
 * próprio sistema, sem tela nossa. A resposta fica em memória e o Explorar, o mapa, a página do evento e o "Para você"
 * a reaproveitam em vez de perguntar de novo. Se a pessoa negar, o app segue normal, sem filtro por perto.
 */
export function PositionAutoAsk() {
  useEffect(() => {
    // Um instante depois de montar, antes do pedido de avisos (PushAutoAsk, 2,5 s), para os dois não chegarem juntos.
    const timer = setTimeout(() => void requestPosition(), 400);
    return () => clearTimeout(timer);
  }, []);
  return null;
}
