/**
 * Desenhos dos ícones das configurações de evento (traço, 24×24). As chaves são as mesmas que a API aceita
 * (`EVENT_EXTRA_ICONS` em apps/api/src/core/event-extras.ts). Só dados: o app e o painel de gestão desenham com isto.
 */
const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

export const EVENT_EXTRA_ICON_PATHS: Readonly<Record<string, readonly string[]>> = {
  smoking: ['M2.5 14h15v4h-15z', 'M14 14v4', 'M20.5 14v4', 'M17.5 11c0-1.5 1.5-1.8 1.5-3.3S17.5 6 17.5 4.5', 'M20.5 11c0-1.5 1-1.8 1-3'],
  car: ['M4 16.5v-4l1.8-4.6A1.5 1.5 0 0 1 7.2 7h9.6a1.5 1.5 0 0 1 1.4.9l1.8 4.6v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z', 'M4 12.5h16', 'M7 17.5v2M17 17.5v2', 'M7.5 14.8h.01M16.5 14.8h.01'],
  parking: ['M5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-13A1.5 1.5 0 0 1 5.5 4z', 'M10 17V8h3.2a2.6 2.6 0 0 1 0 5.2H10'],
  bus: ['M6 17V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v11z', 'M6 11.5h12', 'M5 17h14', 'M8 17v2.5M16 17v2.5', 'M8.8 14.3h.01M15.2 14.3h.01'],
  accessibility: [circle(12, 4.5, 1.6), 'M12 7.5v5.5h4.5l2 5', 'M12 10h4', 'M9 10.6a5 5 0 1 0 6.6 6.4'],
  pet: [circle(6.5, 10, 1.6), circle(9.5, 6, 1.6), circle(14.5, 6, 1.6), circle(17.5, 10, 1.6), 'M12 11.5c-2.6 0-4.8 2.8-4.8 5 0 1.6 1.2 2.6 2.6 2.6.9 0 1.4-.4 2.2-.4s1.3.4 2.2.4c1.4 0 2.6-1 2.6-2.6 0-2.2-2.2-5-4.8-5z'],
  kids: [circle(12, 5, 2), 'M9 21l1.2-5.5H8.5L10.5 9h3l2 6.5h-1.7L15 21', 'M8 11l-2 2.5M16 11l2 2.5'],
  id: ['M4.5 5.5h15A1.5 1.5 0 0 1 21 7v10a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17V7a1.5 1.5 0 0 1 1.5-1.5z', circle(8.5, 11, 2), 'M5.5 16c.5-1.6 1.6-2.5 3-2.5s2.5.9 3 2.5', 'M14 10h4M14 13.5h3'],
  drink: ['M5 4h14l-7 8z', 'M12 12v8', 'M8 20h8', 'M15 4l2-2'],
  food: ['M7 3v18', 'M4 3v5a3 3 0 0 0 6 0V3', 'M17 21V3c-2 1-3.5 3.5-3.5 7.5H17'],
  music: ['M9 18V5.5l11-2V16', circle(6, 18, 3), circle(17, 16, 3)],
  wifi: ['M2.5 9a14 14 0 0 1 19 0', 'M5.5 12.5a9.5 9.5 0 0 1 13 0', 'M8.5 16a5 5 0 0 1 7 0', 'M12 19.5h.01'],
  shirt: ['M8.5 3.5L3.5 6l2 4.5 2-1V20.5h9V9.5l2 1 2-4.5-5-2.5a3.5 3.5 0 0 1-7 0z'],
  ticket: ['M4 7.5A1.5 1.5 0 0 1 5.5 6h13A1.5 1.5 0 0 1 20 7.5V10a2 2 0 0 0 0 4v2.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16.5V14a2 2 0 0 0 0-4z', 'M14 6v12'],
  money: ['M4 6.5h16A1.5 1.5 0 0 1 21.5 8v8a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 16V8A1.5 1.5 0 0 1 4 6.5z', circle(12, 12, 2.5), 'M6 10v4M18 10v4'],
  clock: [circle(12, 12, 8.5), 'M12 7.5V12l3 2'],
  pin: ['M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z', circle(12, 10, 2.3)],
  sun: [circle(12, 12, 4), 'M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4'],
  umbrella: ['M3 12a9 9 0 0 1 18 0z', 'M12 12v6.5a2 2 0 0 1-4 0', 'M12 3v-.5'],
  camera: ['M4 8.5h3.2L8.8 6h6.4l1.6 2.5H20a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5a1 1 0 0 1 1-1z', circle(12, 13.5, 3.5)],
  shield: ['M12 3l7.5 3v5.5c0 4.5-3.2 8.2-7.5 9.5-4.3-1.3-7.5-5-7.5-9.5V6z', 'M9 12l2 2 4-4'],
  users: [circle(9, 8.5, 3), 'M3.5 19.5c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5', 'M15.5 5.8a3 3 0 0 1 0 5.4', 'M17.5 14.8c1.6.6 2.7 2.2 3 4.7'],
  star: ['M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z'],
  info: [circle(12, 12, 8.5), 'M12 11v5', 'M12 8h.01'],
};

/** Nome de cada ícone para quem escolhe na gestão. */
export const EVENT_EXTRA_ICON_LABELS: Readonly<Record<string, string>> = {
  smoking: 'Cigarro', car: 'Carro', parking: 'Estacionamento', bus: 'Transporte', accessibility: 'Acessibilidade', pet: 'Pet',
  kids: 'Criança', id: 'Documento/idade', drink: 'Bebida', food: 'Comida', music: 'Música', wifi: 'Wi-Fi',
  shirt: 'Traje', ticket: 'Ingresso', money: 'Dinheiro', clock: 'Horário', pin: 'Local', sun: 'Ao ar livre',
  umbrella: 'Coberto/chuva', camera: 'Fotos', shield: 'Segurança', users: 'Lotação', star: 'Destaque', info: 'Informação',
};

/** Ícone desconhecido (a gestão pode ganhar ícones novos antes do app atualizar) cai no de informação. */
export function eventExtraIconPaths(icon: string): readonly string[] {
  return EVENT_EXTRA_ICON_PATHS[icon] ?? (EVENT_EXTRA_ICON_PATHS['info'] as readonly string[]);
}
