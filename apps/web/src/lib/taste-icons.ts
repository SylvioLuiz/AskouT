/**
 * Desenhos dos ícones dos gostos de rolê (traço, 24×24). As chaves são as mesmas que a API aceita
 * (`TASTE_ICONS` em apps/api/src/core/tastes.ts). Só dados: o app e o painel de gestão desenham com isto.
 */
const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

export const TASTE_ICON_PATHS: Readonly<Record<string, readonly string[]>> = {
  beer: ['M5 7.5h10V19a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z', 'M15 9.5h2.5a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5H15', 'M8 11v6M12 11v6', 'M5 7.5c0-1.6 1.2-2.8 2.7-2.8.6 0 1.1.2 1.5.5.4-.3.9-.5 1.5-.5 1.5 0 2.3 1.2 2.3 2.8'],
  drink: ['M5 4h14l-7 8z', 'M12 12v8', 'M8 20h8', 'M15 4l2-2'],
  moon: ['M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z', 'M17.5 3.5v3M16 5h3'],
  mic: ['M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z', 'M6 11a6 6 0 0 0 12 0', 'M12 17v4', 'M9 21h6'],
  music: ['M9 18V5.5l11-2V16', circle(6, 18, 3), circle(17, 16, 3)],
  food: ['M7 3v18', 'M4 3v5a3 3 0 0 0 6 0V3', 'M17 21V3c-2 1-3.5 3.5-3.5 7.5H17'],
  coffee: ['M5 9h11v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z', 'M16 10h1.5a2.5 2.5 0 0 1 0 5H16', 'M8 3.5v2M12 3.5v2'],
  film: ['M4 5h16v14H4z', 'M8 5v14M16 5v14', 'M4 9h4M4 15h4M16 9h4M16 15h4'],
  dice: ['M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z', 'M12 8l4 7H8z', 'M12 8V3', 'M16 15l3.8 1.5', 'M8 15l-3.8 1.5'],
  gamepad: ['M7 8h10a4 4 0 0 1 4 4v1a3 3 0 0 1-5.2 2l-1.3-1.5h-5L8.2 15A3 3 0 0 1 3 13v-1a4 4 0 0 1 4-4z', 'M8 10.5v3M6.5 12h3', 'M16 11.5h.01M18 13h.01'],
  tree: ['M12 21v-5', 'M12 3l5.5 7h-3L18 15H6l3.5-5h-3z'],
  ball: [circle(12, 12, 9), 'M3.5 9.5c5 1.5 12 1.5 17 0', 'M3.5 14.5c5-1.5 12-1.5 17 0', 'M12 3v18'],
  heart: ['M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.2 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z'],
  star: ['M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z'],
  book: ['M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z', 'M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z'],
  palette: ['M12 3a9 9 0 0 0 0 18c1.4 0 2-.9 2-1.8 0-1.2-1-1.4-1-2.5 0-.9.7-1.7 1.7-1.7H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z', 'M7.5 11h.01M10 7.5h.01M14.5 7.5h.01'],
  camera: ['M4 8.5h3.2L8.8 6h6.4l1.6 2.5H20a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5a1 1 0 0 1 1-1z', circle(12, 13.5, 3.5)],
  users: [circle(9, 8.5, 3), 'M3.5 19.5c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5', 'M15.5 5.8a3 3 0 0 1 0 5.4', 'M17.5 14.8c1.6.6 2.7 2.2 3 4.7'],
  paw: [circle(6.5, 10, 1.6), circle(9.5, 6, 1.6), circle(14.5, 6, 1.6), circle(17.5, 10, 1.6), 'M12 11.5c-2.6 0-4.8 2.8-4.8 5 0 1.6 1.2 2.6 2.6 2.6.9 0 1.4-.4 2.2-.4s1.3.4 2.2.4c1.4 0 2.6-1 2.6-2.6 0-2.2-2.2-5-4.8-5z'],
};

/** Nome de cada ícone para quem escolhe na gestão. */
export const TASTE_ICON_LABELS: Readonly<Record<string, string>> = {
  beer: 'Chope', drink: 'Drink', moon: 'Noite', mic: 'Microfone', music: 'Música', food: 'Comida', coffee: 'Café', film: 'Cinema',
  dice: 'Dado (RPG)', gamepad: 'Jogos', tree: 'Ao ar livre', ball: 'Bola', heart: 'Coração', star: 'Estrela', book: 'Livro',
  palette: 'Arte', camera: 'Fotos', users: 'Turma', paw: 'Pet',
};

/** Ícone desconhecido (a gestão pode ganhar ícones novos antes do app atualizar) cai no de estrela. */
export function tasteIconPaths(icon: string | undefined): readonly string[] {
  return (icon ? TASTE_ICON_PATHS[icon] : undefined) ?? (TASTE_ICON_PATHS['star'] as readonly string[]);
}
