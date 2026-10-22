import type { ReactNode } from 'react';

/** O anel colorido do AskouT girando. Com “reduzir movimento” ligado no aparelho, aparece parado. */
export function RingLoader({ size = 120, label = 'Carregando', children }: { size?: number; label?: string; children?: ReactNode }) {
  return (
    <span className="ringloader" style={{ width: size, height: size }} role="status" aria-live="polite">
      <picture>
        <source media="(prefers-reduced-motion: reduce)" srcSet="/ring-still.png" />
        <img src="/ring.webp" alt="" width={size} height={size} />
      </picture>
      {children ? <span className="ringloader__center">{children}</span> : null}
      <span className="visually-hidden">{label}…</span>
    </span>
  );
}
