// Tipos e dados comuns aos textos legais (pt-BR, en e es).

/** Data da versão do texto (mudar a cada alteração). */
export const LEGAL_UPDATED = '22 de outubro de 2026';
export const LEGAL_UPDATED_EN = 'October 22, 2026';
export const LEGAL_UPDATED_ES = '22 de octubre de 2026';

export interface LegalBlock {
  title: string;
  /** Parágrafos. */
  text?: string[];
  /** Lista de itens. */
  items?: string[];
}

export interface LegalDoc {
  title: string;
  intro: string;
  blocks: LegalBlock[];
  /** Aviso mostrado no topo das traduções de cortesia. */
  notice?: string;
  /** Data da versão, no idioma do texto. Sem isso, usa a data em português. */
  updated?: string;
}

/** Quem opera o AskouT. Dados do contrato social (JUCESP, NIRE 35238445720); o endereço é o informado pelo sócio em 22/10/2026. */
export const COMPANY = {
  name: 'Thunderbolt LTDA',
  cnpj: '44.953.028/0001-19',
  address: 'Av. Jabaquara, 1909, sala 62, São Paulo/SP',
  dpo: 'Sylvio Luiz de Souza',
};
