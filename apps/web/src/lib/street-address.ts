// Endereço escolhido como rua (sem número) na busca de local: o app pede o número e monta o nome e o endereço.

/** Número aceito: tem ao menos um dígito; letras, "/" e "-" para "20B", "12-A". O servidor confere igual. */
export const HOUSE_NUMBER_RE = /^(?=.*\d)[0-9A-Za-z/-]{1,10}$/;

/** Número digitado junto com a rua na busca ("rua augusta 1500"), para já vir preenchido. Não pega o número do próprio nome ("Rua 7"). */
export function numberFromQuery(q: string, streetName = ''): string {
  const m = /(?:^|[\s,])(\d{1,6}[A-Za-z]?)\s*$/.exec(q.trim());
  if (!m) return '';
  const n = m[1]!.toUpperCase();
  return new RegExp(`(^|\\D)${n}$`, 'i').test(streetName.trim()) ? '' : n;
}

/** Nome da rua para comparar ("R. Augusta" e "Rua Augusta" são a mesma). */
export function streetKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/^(rua|r|avenida|av|travessa|tv|alameda|al|estrada|est|rodovia|rod|praca|pca|largo|lgo|viela|ladeira|lad)\.?\s+/, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "Rua X, 123 - complemento - Bairro - Cidade": o que a busca dava da rua (bairro, cidade) continua, sem repetir a rua. */
export function streetAddress(street: { name: string; address: string | null }, number: string, complement: string): { name: string; address: string } {
  const name = `${street.name.trim()}, ${number.trim()}`;
  const own = streetKey(street.name);
  const rest = (street.address ?? '').split(' - ').map((part) => part.trim()).filter((part) => part !== '' && streetKey(part) !== own);
  return { name, address: [name, complement.trim(), ...rest].filter(Boolean).join(' - ').slice(0, 200) };
}

