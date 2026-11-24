import { createHash } from 'node:crypto';

/**
 * Chave da rede de quem chamou, para ligar o toque no link de convite ao cadastro feito logo depois no app.
 * Guarda só um hash, nunca o IP. No IPv6 usa o prefixo /64, que é o mesmo para o aparelho mesmo quando o
 * endereço completo muda (privacidade do IPv6). IPv4 dentro de IPv6 (`::ffff:1.2.3.4`) vira o IPv4.
 */
export function networkKey(ip: string | undefined): string {
  let raw = (ip ?? '').trim().toLowerCase();
  if (!raw) return '';
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(raw);
  if (mapped?.[1]) raw = mapped[1];
  else if (raw.includes(':')) raw = ipv6Prefix64(raw);
  return createHash('sha256').update(`askout-invite:${raw}`).digest('hex').slice(0, 32);
}

function ipv6Prefix64(ip: string): string {
  const clean = ip.split('%')[0] ?? '';
  const [head = '', tail] = clean.split('::');
  const left = head ? head.split(':') : [];
  const right = tail !== undefined && tail ? tail.split(':') : [];
  const missing = tail === undefined ? 0 : 8 - left.length - right.length;
  const full = [...left, ...Array<string>(Math.max(missing, 0)).fill('0'), ...right];
  return full
    .slice(0, 4)
    .map((h) => (h.replace(/^0+/, '') || '0'))
    .join(':');
}
