import { useEffect, useRef } from 'react';

/**
 * Esc e o botão voltar do Android (a casca dispara `askout:back` antes de voltar a página; cancelar o evento
 * faz só um passo aqui dentro). Cada tela chama `step` quando está por cima e devolve true se tratou.
 */
export function useBackStep(step: () => boolean, active = true) {
  const stepRef = useRef(step);
  stepRef.current = step;
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') stepRef.current();
    };
    const onBack = (event: Event) => {
      if (stepRef.current()) event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('askout:back', onBack);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('askout:back', onBack);
    };
  }, [active]);
}
