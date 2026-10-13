import { Catch, Logger } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { DomainError } from '../core/errors.ts';
import { describeError } from './support/error-mapping.ts';

interface ResponseLike {
  status(code: number): ResponseLike;
  setHeader(name: string, value: string): unknown;
  json(body: unknown): unknown;
}

/** Único ponto que transforma erro em resposta. Só erros inesperados (5xx) vão para o log. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Erros');

  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<ResponseLike>();
    const described = describeError(error);

    if (described.status >= 500 && !(error instanceof DomainError)) {
      this.logger.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    }
    for (const [name, value] of Object.entries(described.headers)) response.setHeader(name, value);
    response.status(described.status).json(described.body);
  }
}
