/** Corpo da requisição como objeto simples; qualquer outra coisa (array, string, null) vira {} e cai na validação do núcleo. */
export function asBody(body: unknown): Record<string, unknown> {
  return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

/** Inteiro de query string; ausente ou inválido vira undefined (o núcleo aplica o padrão e os limites). */
export function parseIntParam(value: unknown): number | undefined {
  if (typeof value !== 'string' || !/^\d{1,9}$/.test(value)) return undefined;
  return Number(value);
}

/** Extrai o token de "Authorization: Bearer <token>". */
export function bearerToken(header: unknown): string | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string') return undefined;
  const match = /^Bearer ([^\s]+)$/i.exec(value.trim());
  return match?.[1];
}
