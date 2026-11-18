/** Telas do modo estabelecimento: o app troca o menu e só o botão "Voltar para o perfil" sai dele. */
const ADMIN_SECTIONS = ['painel', 'eventos', 'equipe', 'agenda', 'impulsionar'] as const;

export type VenueAdminSection = (typeof ADMIN_SECTIONS)[number];

export interface VenueAdminRoute {
  venueId: string;
  /** Aba do menu que fica ativa (a chapelaria pertence aos eventos). */
  section: VenueAdminSection;
}

/** Reconhece `/bares/:id/<seção>` (e a chapelaria de um evento). A página pública `/bares/:id` não é modo estabelecimento. */
export function venueAdminRoute(pathname: string): VenueAdminRoute | undefined {
  const parts = pathname.split('/').filter((p) => p !== '');
  if (parts[0] !== 'bares' || !parts[1]) return undefined;
  let venueId: string;
  try {
    venueId = decodeURIComponent(parts[1]);
  } catch {
    return undefined;
  }
  const section = parts[2];
  if (parts.length === 3 && (ADMIN_SECTIONS as readonly string[]).includes(section ?? '')) return { venueId, section: section as VenueAdminSection };
  if (parts.length === 5 && section === 'eventos' && parts[4] === 'chapelaria') return { venueId, section: 'eventos' };
  return undefined;
}

export interface VenueAdminTab {
  section: VenueAdminSection;
  to: string;
  label: string;
}

/** Abas do menu de baixo. Impulsionar só aparece para o responsável. */
export function venueAdminTabs(venueId: string, isOwner: boolean, labels: Record<VenueAdminSection, string>): VenueAdminTab[] {
  const base = `/bares/${encodeURIComponent(venueId)}`;
  const all: VenueAdminSection[] = ['painel', 'eventos', 'agenda', 'equipe', 'impulsionar'];
  return all.filter((s) => s !== 'impulsionar' || isOwner).map((section) => ({ section, to: `${base}/${section}`, label: labels[section] }));
}
