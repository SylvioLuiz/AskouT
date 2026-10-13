export type Params = Record<string, string>;

/**
 * Compara um caminho com um padrão como "/u/:username/seguidores".
 * Devolve os parâmetros (já decodificados) ou undefined se não casar.
 */
export function matchPath(pattern: string, path: string): Params | undefined {
  const split = (value: string) => value.split('/').filter((part) => part !== '');
  const patternParts = split(pattern);
  const pathParts = split(path);
  if (patternParts.length !== pathParts.length) return undefined;

  const params: Params = {};
  for (let i = 0; i < patternParts.length; i += 1) {
    const expected = patternParts[i] as string;
    const actual = pathParts[i] as string;
    if (expected.startsWith(':')) {
      try {
        params[expected.slice(1)] = decodeURIComponent(actual);
      } catch {
        return undefined;
      }
    } else if (expected !== actual) {
      return undefined;
    }
  }
  return params;
}
