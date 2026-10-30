/** Descobre o que foi denunciado pelo caminho da rota; `undefined` se não for uma denúncia. */
export function reportKind(method: string, path: string): string | undefined {
  if (method !== 'POST') return undefined;
  const p = path.split('?')[0]!.replace(/\/+$/, '');
  if (!p.endsWith('/report')) return undefined;
  if (/\/comments\/[^/]+\/report$/.test(p)) return 'comentário';
  if (/\/stories\/[^/]+\/report$/.test(p)) return 'story de evento';
  if (/\/posts\/[^/]+\/report$/.test(p)) return 'post';
  if (/\/conversations\/[^/]+\/report$/.test(p)) return 'conversa';
  if (/\/profiles\/[^/]+\/report$/.test(p) || /^\/?[^/]+\/report$/.test(p)) return 'perfil';
  return 'conteúdo';
}

