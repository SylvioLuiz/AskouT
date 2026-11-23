export type EventKind = string;

/** Evento como o conector o entrega, antes de qualquer decisão. */
export interface Candidate {
  source: string;
  sourceUrl: string;
  officialSource: boolean;
  title: string;
  description?: string;
  startsAt?: string;
  endsAt?: string;
  venueName?: string;
  venueAddress?: string;
  imageUrl?: string;
  ticketUrl?: string;
  kind?: EventKind;
  tags?: string[];
}

export interface Connector {
  readonly name: string;
  fetch(): Promise<Candidate[]>;
}

export interface ScoreBreakdown {
  dateTime: number;
  venue: number;
  officialSource: number;
  image: number;
  coherence: number;
  multipleSources: number;
}

export type Decision = 'PUBLISH' | 'REVIEW' | 'NO_VENUE';
