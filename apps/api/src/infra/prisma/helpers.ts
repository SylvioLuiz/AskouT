const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** As colunas de id são `uuid`: consultar com outro formato faria o Prisma lançar erro em vez de "não achei". */
export function isUuid(value: string): boolean {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function onlyUuids(values: string[]): string[] {
  return values.filter(isUuid);
}

function prismaErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

/** Violação de unicidade (P2002): retorna os campos/constraints envolvidos. */
export function uniqueViolationTargets(error: unknown): string[] | undefined {
  if (prismaErrorCode(error) !== 'P2002') return undefined;
  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  if (Array.isArray(target)) return target.map(String);
  if (typeof target === 'string') return [target];
  return [];
}

/** Registro a atualizar não existe (P2025). */
export function isRecordNotFound(error: unknown): boolean {
  return prismaErrorCode(error) === 'P2025';
}
