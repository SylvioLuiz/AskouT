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
