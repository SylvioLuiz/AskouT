import { useState } from 'react';
import { safeImage } from '../lib/explore.ts';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')).toUpperCase();
}

/** Logo do estabelecimento em círculo; sem logo (ou se falhar), as iniciais do nome. */
export function VenueLogo({ name, logoUrl, size = 40 }: { name: string; logoUrl: string | null | undefined; size?: number }) {
  const [failed, setFailed] = useState(false);
  const src = failed ? null : safeImage(logoUrl ?? null);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.36) };
  return src ? (
    <img className="vlogo" src={src} alt="" style={style} referrerPolicy="no-referrer" onError={() => setFailed(true)} />
  ) : (
    <span className="vlogo vlogo--initials" style={style} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
