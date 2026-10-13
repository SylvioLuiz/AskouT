export type ErrorCode = 'VALIDATION' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT';

/**
 * Erro de regra de negócio. A camada HTTP (futura) mapeia `code` para o status:
 * VALIDATION 400, UNAUTHORIZED 401, FORBIDDEN 403, NOT_FOUND 404, CONFLICT 409.
 * `message` é seguro para exibir ao usuário; `details` mapeia campo -> motivo.
 */
export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, string> | undefined;

  constructor(code: ErrorCode, message: string, details?: Record<string, string>) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }
}

export const validationError = (message: string, details?: Record<string, string>) =>
  new DomainError('VALIDATION', message, details);
export const unauthorized = (message = 'Credenciais inválidas') => new DomainError('UNAUTHORIZED', message);
export const forbidden = (message: string) => new DomainError('FORBIDDEN', message);
export const notFound = (message = 'Não encontrado') => new DomainError('NOT_FOUND', message);
export const conflict = (message: string, details?: Record<string, string>) =>
  new DomainError('CONFLICT', message, details);
