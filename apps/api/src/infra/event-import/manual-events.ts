import type { EventKind } from '../../core/types.ts';
import { EVENT_KINDS } from '../../core/types.ts';
import type { ImportedEvent } from './niche.ts';

/**
 * Agenda CURADA à mão (`apps/api/scripts/manual-events.json`): eventos e noites fixas de bares que publicam a programação só
 * no Instagram. Cada item vale como "fonte" própria e já vem com tipo (não passa pelo filtro de nicho, quem curou decidiu).
 * Dois jeitos de escrever:
 *   - evento avulso:  { "date": "2026-11-28", ... }
 *   - noite fixa:     { "weekday": 4, ... }  (0 = domingo ... 6 = sábado), repetida nas próximas semanas; `skip` tira datas.
 * O horário vem do post quando tem; senão é o de abertura da casa, e a descrição avisa para confirmar com a casa.
 */
export const MANUAL_SOURCE = 'manual';

const AREAS: Record<string, { name: string; lat: number; lng: number }> = {
  mogi: { name: 'Mogi das Cruzes', lat: -23.5225, lng: -46.1883 },
  sp: { name: 'São Paulo', lat: -23.5505, lng: -46.6333 },
  santos: { name: 'Santos', lat: -23.9663, lng: -46.3336 },
};
const DAY = 86_400_000;

export interface ManualEntry {
  title: string;
  venue: string;
  address?: string;
  area: keyof typeof AREAS | string;
  kind: EventKind;
  /** "AAAA-MM-DD" (evento avulso). */
  date?: string;
  /** 0 a 6 (noite fixa semanal). */
  weekday?: number;
  /** Datas "AAAA-MM-DD" que uma noite fixa não acontece. */
  skip?: string[];
  start: string;
  /** "HH:MM"; sem ele, 4 horas depois do começo. */
  end?: string;
  description?: string;
  /** Quem informou, para o crédito: "Instagram do Grow (@instagrow.exe)". */
  credit: string;
  /** Página de origem (https). */
  link: string;
  free?: boolean;
  /** true quando o horário é o de abertura da casa e não o da festa. */
  approxTime?: boolean;
  image?: string;
}

const slug = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

function clock(text: string | undefined): [number, number] | undefined {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text ?? '');
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? [Number(m[1]), Number(m[2])] : undefined;
}

/** Valida uma lista vinda do JSON. Item inválido vira erro com o motivo (melhor falhar alto do que importar errado). */
export function validateManual(raw: unknown): ManualEntry[] {
  if (!Array.isArray(raw)) throw new Error('manual-events.json precisa ser uma lista');
  return raw.map((item, i) => {
    const e = item as Partial<ManualEntry>;
    const where = `item ${i + 1} (${e.title ?? '?'})`;
    if (!e.title || !e.venue || !e.credit || !e.link || !e.start) throw new Error(`${where}: faltam título, local, crédito, link ou início`);
    if (!/^https:\/\//.test(e.link)) throw new Error(`${where}: o link precisa ser https`);
    if (!clock(e.start) || (e.end !== undefined && !clock(e.end))) throw new Error(`${where}: horário inválido (use HH:MM)`);
    if (!AREAS[e.area ?? '']) throw new Error(`${where}: região desconhecida (${Object.keys(AREAS).join(', ')})`);
    if (!(EVENT_KINDS as readonly string[]).includes(e.kind ?? '')) throw new Error(`${where}: tipo inválido`);
    const hasDate = typeof e.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.date);
    const hasWeekday = Number.isInteger(e.weekday) && (e.weekday as number) >= 0 && (e.weekday as number) <= 6;
    if (hasDate === hasWeekday) throw new Error(`${where}: informe "date" (avulso) OU "weekday" (noite fixa), um só`);
    return e as ManualEntry;
  });
}

/** Datas (dia civil, "AAAA-MM-DD") de uma entrada dentro do horizonte, a partir de hoje em São Paulo. */
function datesOf(entry: ManualEntry, now: Date, horizonDays: number): string[] {
  const todaySp = new Date(now.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
  const last = new Date(Date.parse(`${todaySp}T00:00:00Z`) + horizonDays * DAY).toISOString().slice(0, 10);
  // Evento avulso já anunciado entra mesmo longe (ex.: festival daqui a um mês); só a noite fixa repete dentro do horizonte.
  if (entry.date) return entry.date >= todaySp && entry.date <= new Date(Date.parse(`${todaySp}T00:00:00Z`) + 180 * DAY).toISOString().slice(0, 10) ? [entry.date] : [];
  const out: string[] = [];
  for (let t = Date.parse(`${todaySp}T00:00:00Z`); t <= Date.parse(`${last}T00:00:00Z`); t += DAY) {
    const d = new Date(t);
    const iso = d.toISOString().slice(0, 10);
    if (d.getUTCDay() === entry.weekday && !(entry.skip ?? []).includes(iso)) out.push(iso);
  }
  return out;
}

export function manualEvents(entries: readonly ManualEntry[], now: Date, horizonDays = 21): ImportedEvent[] {
  const out: ImportedEvent[] = [];
  for (const entry of entries) {
    const area = AREAS[entry.area]!;
    const [sh, sm] = clock(entry.start)!;
    const end = clock(entry.end);
    for (const date of datesOf(entry, now, horizonDays)) {
      const [y, m, d] = date.split('-').map(Number) as [number, number, number];
      const startsAt = new Date(Date.UTC(y, m - 1, d, sh + 3, sm));
      let endsAt = end ? new Date(Date.UTC(y, m - 1, d, end[0] + 3, end[1])) : new Date(startsAt.getTime() + 4 * 3_600_000);
      if (endsAt.getTime() <= startsAt.getTime()) endsAt = new Date(endsAt.getTime() + DAY);
      if (endsAt.getTime() < now.getTime()) continue;
      const note = entry.approxTime === false ? '' : 'Horário a confirmar com a casa.';
      out.push({
        source: MANUAL_SOURCE,
        sourceId: `${slug(entry.venue)}-${slug(entry.title)}-${date}`,
        title: entry.title.slice(0, 120),
        description: [entry.description ?? '', note].filter((t) => t !== '').join(' ').slice(0, 900),
        startsAt,
        endsAt,
        venueName: entry.venue.slice(0, 80),
        address: entry.address ?? null,
        isFree: entry.free === true,
        imageUrl: entry.image && /^https:\/\//.test(entry.image) ? entry.image : null,
        link: entry.link,
        sourceName: entry.credit,
        area,
        kind: entry.kind,
      });
    }
  }
  return out;
}
