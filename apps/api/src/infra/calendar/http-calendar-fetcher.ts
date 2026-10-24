import { lookup as dnsLookup } from 'node:dns';
import type { LookupFunction } from 'node:net';
import { isIP } from 'node:net';
import https from 'node:https';
import { CalendarFetchError } from '../../core/ports.ts';
import type { CalendarFetcher } from '../../core/ports.ts';

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

/** Endereços que nunca devem ser acessados a pedido de alguém: rede interna, loopback, link-local (inclui metadados de nuvem), multicast. */
export function isPrivateAddress(address: string): boolean {
  const v = isIP(address);
  if (v === 4) {
    const [a, b] = address.split('.').map(Number) as [number, number];
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (v === 6) {
    const x = address.toLowerCase();
    if (x === '::' || x === '::1') return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x);
    if (mapped) return isPrivateAddress(mapped[1]!);
    return x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe8') || x.startsWith('fe9') || x.startsWith('fea') || x.startsWith('feb') || x.startsWith('ff') || x.startsWith('::ffff:');
  }
  return true;
}

/** Resolve o nome e recusa endereço interno NA HORA da conexão (vale também para redirecionamentos e contra troca de DNS). */
const safeLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, '', 4);
    const list = Array.isArray(addresses) ? addresses : [];
    if (list.length === 0 || list.some((a) => isPrivateAddress(a.address))) return callback(new Error('private-address'), '', 4);
    const first = list[0]!;
    if (options.all) return (callback as unknown as (e: null, a: typeof list) => void)(null, list);
    return callback(null, first.address, first.family);
  });
};

/** Lê uma agenda iCal pela internet: só https, só endereços públicos, com limite de tempo, de tamanho e de redirecionamentos. */
export class HttpCalendarFetcher implements CalendarFetcher {
  async fetch(url: string): Promise<string> {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const res = await this.get(current);
      if (res.redirect) {
        current = new URL(res.redirect, current).toString();
        continue;
      }
      return res.body;
    }
    throw new CalendarFetchError('O endereço redireciona demais');
  }

  private get(raw: string): Promise<{ body: string; redirect?: string }> {
    return new Promise((resolve, reject) => {
      let url: URL;
      try {
        url = new URL(raw);
      } catch {
        reject(new CalendarFetchError('Endereço inválido'));
        return;
      }
      if (url.protocol !== 'https:') {
        reject(new CalendarFetchError('Só endereços https:// são aceitos'));
        return;
      }
      // Endereço numérico não passa pelo `lookup`: recusa direto (vale também para redirecionamentos).
      const bare = url.hostname.replace(/^\[|\]$/g, '');
      if (isIP(bare) !== 0) {
        reject(new CalendarFetchError('Use o endereço público da agenda'));
        return;
      }
      const req = https.get(url, { lookup: safeLookup, timeout: TIMEOUT_MS, headers: { accept: 'text/calendar, text/plain;q=0.8, */*;q=0.1', 'user-agent': 'AskouT-Agenda/1.0 (+https://askout.com.br)' } }, (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && typeof res.headers.location === 'string') {
          res.resume();
          resolve({ body: '', redirect: res.headers.location });
          return;
        }
        if (status === 404 || status === 410) {
          res.resume();
          reject(new CalendarFetchError('A agenda não foi encontrada. Confira o endereço.'));
          return;
        }
        if (status === 401 || status === 403) {
          res.resume();
          reject(new CalendarFetchError('A agenda não está pública. Use o endereço secreto no formato iCal.'));
          return;
        }
        if (status < 200 || status >= 300) {
          res.resume();
          reject(new CalendarFetchError('Não foi possível abrir a agenda'));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            req.destroy();
            reject(new CalendarFetchError('A agenda é grande demais'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => resolve({ body: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', () => reject(new CalendarFetchError('Não foi possível abrir a agenda')));
      });
      req.on('timeout', () => {
        req.destroy();
        reject(new CalendarFetchError('A agenda demorou demais para responder'));
      });
      req.on('error', (error) => reject(new CalendarFetchError(error.message === 'private-address' ? 'Use o endereço público da agenda' : 'Não foi possível abrir a agenda')));
    });
  }
}
