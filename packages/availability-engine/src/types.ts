/**
 * Todos os instantes são epoch em milissegundos (UTC).
 * Intervalos são semiabertos: [start, end). Intervalos que apenas se tocam
 * (end de um == start do outro) NÃO se sobrepõem.
 */
export type Interval = { start: number; end: number };

export type SlotState = 'available' | 'partial' | 'unavailable';

/** Disponibilidade informada manualmente pelo usuário (já expandida, sem recorrência). */
export type AvailabilitySlot = Interval & { state: SlotState };

export interface ParticipantAvailability {
  userId: string;
  /** Disponibilidade manual. Ausência de slot = "não informado", nunca "indisponível". */
  slots: AvailabilitySlot[];
  /** Apenas intervalos ocupados vindos de calendários externos. Sem título/descrição. */
  busy: Interval[];
}

export type ParticipantStatus = 'available' | 'partial' | 'unavailable' | 'unknown';

export type StatusReason =
  | 'manual_unavailable'
  | 'external_busy'
  | 'fully_available'
  | 'partial_slot'
  | 'partial_coverage'
  | 'no_information';

export interface ParticipantResult {
  userId: string;
  status: ParticipantStatus;
  reason: StatusReason;
}

export type CompatibilityLevel = 'green' | 'orange' | 'red' | 'awaiting';

export interface Counts {
  total: number;
  available: number;
  partial: number;
  unavailable: number;
  unknown: number;
}

export interface CompatibilityResult {
  interval: Interval;
  level: CompatibilityLevel;
  counts: Counts;
  participants: ParticipantResult[];
}

/** Metadados de apresentação: cor sempre acompanhada de texto e ícone (acessibilidade). */
export const COMPATIBILITY_META: Record<
  CompatibilityLevel,
  { label: string; icon: 'check' | 'alert' | 'x' | 'clock' }
> = {
  green: { label: 'Alta compatibilidade', icon: 'check' },
  orange: { label: 'Compatibilidade parcial', icon: 'alert' },
  red: { label: 'Baixa compatibilidade', icon: 'x' },
  awaiting: { label: 'Aguardando informações', icon: 'clock' },
};
