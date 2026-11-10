import type { PostReportReason, ReportResolution } from './types.ts';

/** Quanto tempo um story de local fica no ar. */
export const VENUE_STORY_HOURS = 24;
/** Quantos stories no ar um local pode ter ao mesmo tempo. */
export const VENUE_STORY_MAX_LIVE = 10;
export const VENUE_STORY_REPORT_DETAILS_MAX = 300;
/** Quantas pessoas diferentes precisam ter denunciado (denúncias ainda abertas) para a publicação do local ser suspensa. */
export const VENUE_STORY_SUSPEND_REPORTERS = 3;
/** Só contam denúncias dos últimos dias. */
export const VENUE_STORY_SUSPEND_DAYS = 7;
/** Raio padrão da faixa "Rolando agora". */
export const ROLLING_RADIUS_KM = 10;
export const ROLLING_LIMIT = 20;

/** Um story de um local verificado (com responsável): foto ou vídeo, público para quem não bloqueou nem silenciou o local. */
export interface VenueStoryRecord {
  id: string;
  venueId: string;
  /** Quem publicou (o responsável do local). */
  authorId: string;
  mime: string;
  video: boolean;
  data: Uint8Array;
  createdAt: Date;
  expiresAt: Date;
}

export type VenueStoryMeta = Omit<VenueStoryRecord, 'data'>;

export interface VenueStoryReportRecord {
  id: string;
  storyId: string;
  reporterId: string;
  reason: PostReportReason;
  details: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
  resolution: ReportResolution | null;
  resolutionNote: string | null;
}

/** Preferências de quem vê. */
export interface VenueStoryPrefs {
  /** Não ver stories de locais (nem na Home nem no Explorar). */
  hideAll: boolean;
}

/** Categorias de local em que se vende bebida alcoólica (a categoria vem do cadastro e do Google, em português ou inglês). */
const ALCOHOL_CATEGORY = /\b(bar|pub|botequim|boteco|balada|boate|casa noturna|night ?club|club|cervejaria|choperia|brewery|adega|distribuidora de bebidas|wine|vinho|cocktail|coquetel|lounge|liquor|tabacaria|hookah|narguil)\b/i;

export function isAlcoholVenue(category: string | null | undefined): boolean {
  return typeof category === 'string' && ALCOHOL_CATEGORY.test(category.replace(/_/g, ' '));
}

/** Coordenada arredondada para ~1 km: o Explorar usa só uma região aproximada e nada disso é guardado. */
export function approximate(value: number): number {
  return Math.round(value * 100) / 100;
}
