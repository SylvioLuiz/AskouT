import { useEffect, useState } from 'react';
import { nextTickMs, timeAgo } from '../lib/format.ts';

/** "há 12 s" que anda sozinho no 1º minuto, "há 5 min" até 1 h e depois fica parado. */
export function LiveAgo({ iso }: { iso: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      const wait = nextTickMs(iso, Date.now());
      if (wait === null) return;
      timer = setTimeout(() => {
        setNow(Date.now());
        schedule();
      }, wait);
    };
    schedule();
    return () => clearTimeout(timer);
  }, [iso]);
  return <>{timeAgo(iso, new Date(now), { seconds: true })}</>;
}
