/** Busca em listas de pessoas (amigos, seguidores, seguindo) por nome ou @. */

/** Minúsculo e sem acento, para "joão" achar "Joao". */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Termo digitado pronto para comparar: sem "@" inicial nem espaços nas pontas. Vazio = sem filtro. */
export function peopleQuery(raw: string): string {
  return raw.trim().replace(/^@+/, '').trim();
}

/** O @ começa com o termo ou o nome contém o termo (sem diferenciar maiúsculas nem acentos). */
export function matchesPerson(person: { username: string; displayName: string }, raw: string): boolean {
  const q = fold(peopleQuery(raw));
  if (!q) return true;
  return fold(person.username).startsWith(q) || fold(person.displayName).includes(q);
}
