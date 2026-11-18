import type { CSSProperties } from 'react';
import { t } from './i18n/index.ts';

/**
 * Cores que dá para escolher para uma conversa (só para você; fica salvo na sua conta).
 * Sem cor = a cor padrão do app (rosa). A lista de ids precisa bater com CHAT_COLORS da API.
 *
 * Cada cor troca os tokens da marca só dentro da conversa: balões seus, botão de enviar, links e ícones.
 * - `fill`/`ink`: preenchimento (balão, botão) e o texto por cima dele.
 * - `text`/`soft`: texto e ícones coloridos e o fundo clarinho, no tema claro.
 * - `textDark`/`softDark`: os mesmos no tema escuro.
 */
export interface ChatColor {
  id: string;
  label: string;
  fill: string;
  hover: string;
  ink: string;
  text: string;
  soft: string;
  textDark: string;
  softDark: string;
}

export const CHAT_COLORS: readonly ChatColor[] = [
  { id: 'purple', label: 'Roxo', fill: '#b98cff', hover: '#cba8ff', ink: '#15162a', text: '#7535d4', soft: '#f1e8ff', textDark: '#c7a4ff', softDark: '#2e2348' },
  { id: 'blue', label: 'Azul', fill: '#6fa8ff', hover: '#93beff', ink: '#15162a', text: '#1d5fd0', soft: '#e6f0ff', textDark: '#8cb8ff', softDark: '#1d2b48' },
  { id: 'teal', label: 'Turquesa', fill: '#3fcfc6', hover: '#6fdcd5', ink: '#15162a', text: '#0b7a74', soft: '#e0f7f5', textDark: '#5fdcd4', softDark: '#173a3a' },
  { id: 'green', label: 'Verde', fill: '#5fd68a', hover: '#85e2a6', ink: '#15162a', text: '#1b7a42', soft: '#e3f7ea', textDark: '#72de98', softDark: '#1a3a27' },
  { id: 'yellow', label: 'Amarelo', fill: '#ffd23f', hover: '#ffdd70', ink: '#15162a', text: '#806200', soft: '#fff6d6', textDark: '#ffd85c', softDark: '#3d3416' },
  { id: 'orange', label: 'Laranja', fill: '#ff9f45', hover: '#ffb873', ink: '#15162a', text: '#ad4f06', soft: '#ffeedd', textDark: '#ffb066', softDark: '#42291a' },
  { id: 'red', label: 'Vermelho', fill: '#ff6b6b', hover: '#ff9191', ink: '#15162a', text: '#c42727', soft: '#ffe6e6', textDark: '#ff8a8a', softDark: '#4a1f24' },
  { id: 'graphite', label: 'Grafite', fill: '#4b4f6b', hover: '#5d6283', ink: '#ffffff', text: '#3d4058', soft: '#e9eaf1', textDark: '#c3c7dd', softDark: '#2c2f40' },
];

export function findChatColor(id: string | null | undefined): ChatColor | undefined {
  return id ? CHAT_COLORS.find((c) => c.id === id) : undefined;
}

export const chatColorLabel = (c: ChatColor) => t(c.label);

/** Variáveis CSS que a classe `chat--colored` usa para trocar as cores da marca dentro da conversa. */
export function chatColorStyle(id: string | null | undefined): CSSProperties | undefined {
  const c = findChatColor(id);
  if (!c) return undefined;
  return {
    '--cc-fill': c.fill,
    '--cc-hover': c.hover,
    '--cc-ink': c.ink,
    '--cc-text': c.text,
    '--cc-soft': c.soft,
    '--cc-text-dark': c.textDark,
    '--cc-soft-dark': c.softDark,
  } as CSSProperties;
}
