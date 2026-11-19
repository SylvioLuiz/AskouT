import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import { containRect, overlayLook } from '../lib/story-overlays.ts';
import type { Rect } from '../lib/story-overlays.ts';
import type { StoryOverlay } from '../lib/types.ts';

/**
 * Onde a mídia aparece dentro do palco (encaixada inteira), acompanhando o tamanho da tela.
 * Editor e visualizador usam a mesma conta: o texto fica no mesmo ponto da foto em qualquer aparelho.
 */
export function useMediaBox(stageRef: RefObject<HTMLElement | null>, natural: { width: number; height: number } | undefined): Rect | undefined {
  const [stage, setStage] = useState<{ width: number; height: number } | undefined>();
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setStage({ width: el.clientWidth, height: el.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [stageRef]);
  return stage && natural ? containRect(stage, natural) : undefined;
}

/** Um texto ou figurinha, já no lugar, tamanho e giro certos. `box` é a área da mídia. */
export function StoryOverlayItem({ overlay, box, index, hidden }: { overlay: StoryOverlay; box: Rect; index?: number; hidden?: boolean }) {
  const look = overlayLook(overlay, box.width);
  return (
    <div
      className="storyov"
      data-ov={index}
      style={{ left: `${overlay.x * box.width}px`, top: `${overlay.y * box.height}px`, transform: `translate(-50%, -50%) rotate(${overlay.rotation}deg)`, visibility: hidden ? 'hidden' : undefined }}
    >
      <span className={`storyov__text storyov__text--${overlay.kind === 'STICKER' ? 'sticker' : overlay.style.toLowerCase()}`} style={look}>
        {overlay.text}
      </span>
    </div>
  );
}

/** Camada com todos os textos por cima da mídia, para quem assiste (não recebe toques). */
export function StoryOverlayLayer({ overlays, box }: { overlays: readonly StoryOverlay[]; box: Rect | undefined }) {
  if (!box || overlays.length === 0) return null;
  return (
    <div className="storyovs" style={{ left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` }}>
      {overlays.map((overlay, index) => (
        <StoryOverlayItem key={index} overlay={overlay} box={box} />
      ))}
    </div>
  );
}

/** Quanto o teclado cobre do pé da tela (para a paleta ficar logo acima dele). */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const measure = () => setInset(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
    measure();
    vv.addEventListener('resize', measure);
    vv.addEventListener('scroll', measure);
    return () => {
      vv.removeEventListener('resize', measure);
      vv.removeEventListener('scroll', measure);
    };
  }, []);
  return inset;
}
