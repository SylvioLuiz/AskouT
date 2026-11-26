/** Se o texto termina numa marcação em andamento ("oi @an"), devolve o que já foi digitado depois do @. */
export function mentionQueryAt(text: string): string | undefined {
  const match = /(?:^|\s)@([a-z0-9._]{0,30})$/i.exec(text);
  return match ? (match[1] ?? '').toLowerCase() : undefined;
}

/** Troca a marcação em andamento pelo nome escolhido, com um espaço depois. */
export function applyMention(text: string, username: string): string {
  return text.replace(/(^|\s)@[a-z0-9._]{0,30}$/i, `$1@${username} `);
}

export type MentionPart = { text: string; mention?: string };

/** Quebra o comentário em pedaços; só vira link o @nome que está em `known` (nomes que existem). */
export function splitMentions(body: string, known: readonly string[]): MentionPart[] {
  const set = new Set(known.map((k) => k.toLowerCase()));
  const parts: MentionPart[] = [];
  let last = 0;
  for (const match of body.matchAll(/(?<![\w.@])@([a-z0-9._]{3,30})/gi)) {
    const raw = match[1] ?? '';
    const name = raw.toLowerCase().replace(/\.+$/, '');
    if (!set.has(name)) continue;
    const start = match.index ?? 0;
    const end = start + 1 + name.length;
    if (start > last) parts.push({ text: body.slice(last, start) });
    parts.push({ text: body.slice(start, end), mention: name });
    last = end;
  }
  if (last < body.length) parts.push({ text: body.slice(last) });
  return parts.length ? parts : [{ text: body }];
}

/** Marcação em andamento logo antes do cursor (no chat dá para marcar no meio do texto, não só no fim). */
export function mentionQueryBefore(text: string, caret: number): string | undefined {
  return mentionQueryAt(text.slice(0, Math.max(0, Math.min(caret, text.length))));
}

/** Troca a marcação antes do cursor pelo nome escolhido; devolve o texto novo e onde o cursor fica (logo depois do espaço). */
export function applyMentionAt(text: string, caret: number, username: string): { text: string; caret: number } {
  const at = Math.max(0, Math.min(caret, text.length));
  const before = applyMention(text.slice(0, at), username);
  const after = text.slice(at).replace(/^[a-z0-9._]+/i, '').replace(/^ /, '');
  return { text: before + after, caret: before.length };
}

/**
 * Membros do grupo para a lista de sugestões: com "@" sozinho, todos (até o limite); com letras, primeiro quem tem o
 * usuário começando pelo que foi digitado, depois uma palavra do nome, depois quem só contém o texto.
 */
export function filterMentionCandidates<T extends { username: string; displayName?: string | null }>(people: readonly T[], query: string, limit = 6): T[] {
  const q = fold(query);
  const seen = new Set<string>();
  const unique = people.filter((p) => p.username && !seen.has(p.username.toLowerCase()) && seen.add(p.username.toLowerCase()));
  if (q === '') return unique.slice(0, limit);
  const byUser: T[] = [];
  const byName: T[] = [];
  const contains: T[] = [];
  for (const person of unique) {
    const user = person.username.toLowerCase();
    const name = fold(person.displayName ?? '');
    if (user.startsWith(q)) byUser.push(person);
    else if (name.split(/\s+/).some((word) => word.startsWith(q))) byName.push(person);
    else if (user.includes(q) || name.includes(q)) contains.push(person);
  }
  return [...byUser, ...byName, ...contains].slice(0, limit);
}

function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
