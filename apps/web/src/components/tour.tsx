import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { TOUR_STEPS, tourPlacement, tourProgressLabel } from '../lib/onboarding.ts';
import { navigate } from '../router.tsx';
import { Button } from './ui.tsx';
import { t } from '../lib/i18n/index.ts';

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const PAD = 6;
/** Se o botão não aparece (ex.: menu de estabelecimento), o passo vira só explicação depois deste tempo. */
const MISSING_MS = 600;

/** O botão marcado com data-tour que está na tela agora (o menu lateral e a barra de baixo têm cópias). */
function visibleTarget(name: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden') return el;
  }
  return null;
}

function sameBox(a: Box | null, b: Box | null): boolean {
  return a === b || (!!a && !!b && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height);
}

/**
 * Tour interativo: escurece a tela, destaca o botão de verdade e espera a pessoa tocar nele (o toque navega como
 * sempre). Toques fora do botão e do balão são ignorados enquanto o tour está aberto.
 */
export function Tour({ onDone }: { onDone: () => void }) {
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [missing, setMissing] = useState(false);
  const [finished, setFinished] = useState(false);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const step = TOUR_STEPS[index];
  const interactive = !!step?.to && !missing;

  // Segue o botão a cada quadro: a tela muda de página, rola e muda de tamanho durante o tour.
  useLayoutEffect(() => {
    if (!step || finished) return;
    setMissing(false);
    setBox(null);
    const started = performance.now();
    let frame = 0;
    const tick = () => {
      const el = visibleTarget(step.target);
      if (el) {
        const r = el.getBoundingClientRect();
        const next = { left: r.left - PAD, top: r.top - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 };
        setBox((current) => (sameBox(current, next) ? current : next));
        setMissing(false);
      } else if (performance.now() - started > MISSING_MS) {
        setBox(null);
        setMissing(true);
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [step, finished]);

  const advance = () => {
    if (index + 1 < TOUR_STEPS.length) setIndex(index + 1);
    else setFinished(true);
  };

  // Só o botão destacado e o balão respondem ao toque.
  useEffect(() => {
    if (finished) return;
    const guard = (event: Event) => {
      const node = event.target as Node | null;
      if (node && bubbleRef.current?.contains(node)) return;
      const el = step ? visibleTarget(step.target) : null;
      if (interactive && el && node && el.contains(node)) {
        // Deixa o Link navegar e passa ao próximo passo depois.
        if (event.type === 'click') window.setTimeout(advance, 0);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };
    const types = ['click', 'pointerdown', 'mousedown', 'touchstart'];
    types.forEach((type) => document.addEventListener(type, guard, { capture: true, passive: false }));
    return () => types.forEach((type) => document.removeEventListener(type, guard, { capture: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, interactive, finished]);

  // Esc pula o tour.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDone();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDone]);

  if (finished || !step) {
    return (
      <div className="onb" role="dialog" aria-modal="true" aria-labelledby="tour-fim">
        <div className="onb__card">
          <div className="onb__art onb__art--done" aria-hidden="true">✓</div>
          <h2 id="tour-fim" className="onb__title">{t('Tudo pronto!')}</h2>
          <p className="onb__text">{t('Agora é com você: siga locais, confirme presença nos eventos e ligue o NOW quando quiser sair.')}</p>
          <div className="onb__actions">
            <Button
              full
              onClick={() => {
                navigate('/');
                onDone();
              }}
            >
              {t('Ir para a Home')}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const placement = box ? tourPlacement({ left: box.left, right: box.left + box.width, top: box.top, bottom: box.top + box.height }, viewport) : null;
  const bubbleStyle: CSSProperties = {};
  if (box && placement === 'right') {
    bubbleStyle.left = box.left + box.width + 14;
    bubbleStyle.top = Math.max(12, Math.min(box.top - 8, viewport.height - 240));
  } else if (box) {
    const width = Math.min(340, viewport.width - 24);
    bubbleStyle.width = width;
    bubbleStyle.left = Math.max(12, Math.min(box.left + box.width / 2 - width / 2, viewport.width - width - 12));
    if (placement === 'above') bubbleStyle.bottom = viewport.height - box.top + 14;
    else bubbleStyle.top = box.top + box.height + 14;
  }

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-titulo" aria-describedby="tour-texto">
      {box ? (
        <div className="tour__spot" style={{ left: box.left, top: box.top, width: box.width, height: box.height }} aria-hidden="true" />
      ) : (
        <div className="tour__shade" aria-hidden="true" />
      )}
      <div ref={bubbleRef} className={`tour__bubble${box ? ` tour__bubble--${placement}` : ' tour__bubble--center'}`} style={bubbleStyle}>
        <p className="tour__count">{tourProgressLabel(index)}</p>
        <h2 id="tour-titulo" className="tour__title">{step.title}</h2>
        <p id="tour-texto" className="tour__text">{step.text}</p>
        <div className="tour__actions">
          <Button small variant="quiet" onClick={onDone}>{t('Pular tour')}</Button>
          {interactive ? (
            <span className="tour__hint" role="status">{t('Toque no botão destacado')}</span>
          ) : (
            <Button small onClick={advance}>{t('Entendi')}</Button>
          )}
        </div>
      </div>
    </div>
  );
}
