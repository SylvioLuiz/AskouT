import type { EventKind } from '../../core/types.ts';

/**
 * Filtro de nicho do importador de eventos reais. O AskouT é para pessoas se encontrarem: show, balada, bar,
 * gastronomia, esporte, cultura, ar livre. Fora ficam eventos online, cursos, congressos, religião, reunião de
 * conselho, vacinação e afins, mesmo que a fonte os liste.
 */

export interface ImportedEvent {
  /** Nome da fonte (ex.: "juicy-santos"). */
  source: string;
  /** Id do evento na fonte; com a fonte, identifica o evento (não duplica ao importar de novo). */
  sourceId: string;
  title: string;
  description: string;
  startsAt: Date;
  endsAt: Date;
  venueName: string;
  address: string | null;
  isFree: boolean;
  imageUrl: string | null;
  /** Página do evento na fonte (crédito). */
  link: string;
  /** Nome legível da fonte, para o crédito na descrição. */
  sourceName: string;
  /** Região onde procurar o local no Google. */
  area: { name: string; lat: number; lng: number };
  /** Posição exata do local, quando a fonte informa (usada se o Google não achar o lugar). */
  coords?: { lat: number; lng: number };
  /** Tipo já decidido por quem curou a fonte (pula o filtro de nicho). */
  kind?: EventKind;
}

export type NicheVerdict = { keep: true; kind: EventKind } | { keep: false; reason: string };

const strip = (text: string): string => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Motivos para descartar: nada a ver com encontro de pessoas. */
const REJECT: { reason: string; test: RegExp }[] = [
  { reason: 'online', test: /\b(online|webinar|live stream|transmissao ao vivo|evento digital|remoto)\b/ },
  { reason: 'curso ou palestra', test: /\b(curso|aula|aulas|oficina|oficinas|workshop|treinamento|mentoria|palestra|palestras|ciclo de palestras|seminario|congresso|simposio|capacitacao|aula inaugural|pos-graduacao|vestibular|inscricoes abertas|conferencia)\b/ },
  { reason: 'religioso', test: /\b(missa|culto|retiro espiritual|novena|terco|celebracao religiosa|encontro de oracao)\b/ },
  { reason: 'institucional', test: /\b(conselho municipal|reuniao ordinaria|audiencia publica|licitacao|vacinacao|campanha de vacina|mutirao|concurso publico|plantao|atendimento ao publico)\b/ },
  { reason: 'corporativo', test: /\b(convencao|feirao de empregos|networking empresarial|rodada de negocios|assembleia|palestra motivacional)\b/ },
  { reason: 'infantil', test: /\b(oficina infantil|colonia de ferias)\b/ },
  { reason: 'saude', test: /\b(consulta|exame|doacao de sangue|pre-natal gratuito)\b/ },
];

/** O que é de encontro, por tipo de evento. Ordem: o primeiro que casar manda. */
const KINDS: { kind: EventKind; test: RegExp }[] = [
  { kind: 'NIGHT', test: /\b(balada|festa|baile|open bar|after|pista|dj|noite|rave|club)\b/ },
  { kind: 'SHOW', test: /\b(show|musica ao vivo|samba|pagode|sertanejo|forro|rock|jazz|mpb|tributo|banda|cantor|cantora|acustico|roda de samba|concerto|turne|festival de musica)\b/ },
  { kind: 'THEATER', test: /\b(teatro|espetaculo|stand.?up|comedia|peca|monologo|improviso|danca|circo)\b/ },
  { kind: 'CINEMA', test: /\b(cinema|filme|mostra de curtas|sessao de cinema)\b/ },
  { kind: 'EXHIBITION', test: /\b(exposicao|museu|galeria|vernissage|feira de arte|visita guiada|mostra)\b/ },
  { kind: 'GASTRONOMY', test: /\b(gastronomia|gastronomico|degustacao|jantar|feijoada|churrasco|hamburguer|pizza|brunch|cerveja|vinho|food|festival de comida|restaurante|bar)\b/ },
  { kind: 'SPORT', test: /\b(corrida|futebol|jogo|campeonato|torneio|esporte|maratona|beach tennis|surf|skate|volei|basquete|estadio|clasico)\b/ },
  { kind: 'OUTDOOR', test: /\b(parque|praia|ao ar livre|piquenique|feira|feirinha|bazar|trilha|passeio|pôr do sol|por do sol|mirante|praca)\b/ },
];

/** No Sesc, palestra, oficina, curso, debate e conversa ficam (decisão do responsável): entram como tipo "Outro". */
const TALKS = /\b(palestra|palestras|oficina|oficinas|curso|cursos|workshop|aula aberta|debate|bate-papo|conversa|roda de conversa|formacao|encontro com|mesa)\b/;
const TALK_REASONS = new Set(['curso ou palestra']);

export function classifyEvent(event: Pick<ImportedEvent, 'title' | 'description' | 'venueName'> & { source?: string }): NicheVerdict {
  const title = strip(event.title);
  const all = `${title} ${strip(event.description)} ${strip(event.venueName)}`;
  const sesc = event.source === 'sesc-sp';
  for (const r of sesc ? REJECT.filter((x) => !TALK_REASONS.has(x.reason)) : REJECT) {
    // O título manda: "Curso" no título descarta; no texto só descarta se o título não for de encontro.
    if (r.test.test(title)) return { keep: false, reason: r.reason };
  }
  const bySubject = KINDS.find((k) => k.test.test(title)) ?? KINDS.find((k) => k.test.test(all));
  if (!bySubject) {
    if (sesc && TALKS.test(all)) return { keep: true, kind: 'OTHER' };
    return { keep: false, reason: 'fora do nicho (nenhum tipo de encontro reconhecido)' };
  }
  for (const r of sesc ? REJECT.filter((x) => !TALK_REASONS.has(x.reason)) : REJECT) {
    if (r.test.test(all) && !KINDS.some((k) => k.test.test(title))) return { keep: false, reason: r.reason };
  }
  // Cinema fica de fora do importador (decisão do responsável): sessão de cinema não é encontro de rolê.
  if (bySubject.kind === 'CINEMA') return { keep: false, reason: 'cinema' };
  return { keep: true, kind: bySubject.kind };
}

export const IMPORT_TAGS: Record<EventKind, string[]> = {
  SHOW: ['musicaaovivo', 'show'], NIGHT: ['balada', 'festa'], GASTRONOMY: ['gastronomia'], SPORT: ['esporte'], THEATER: ['teatro'],
  CINEMA: ['cinema'], EXHIBITION: ['arte', 'exposicao'], OUTDOOR: ['arlivre'], DIGITAL: [], OTHER: [],
};
