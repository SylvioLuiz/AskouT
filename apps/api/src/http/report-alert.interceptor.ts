import { Inject, Injectable } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { reportKind } from './support/report-kind.ts';

/** Quem manda o aviso (o envio real é o ResendEmailSender). */
export interface ModerationAlerter {
  sendModerationAlert(input: { to: string; what: string; reason: string | undefined }): Promise<void>;
}
export interface ModerationAlertTarget {
  alerter: ModerationAlerter | undefined;
  to: string;
}
export const MODERATION_ALERT = Symbol('MODERATION_ALERT');

/**
 * Avisa a equipe por e-mail a cada denúncia nova (a Apple exige ação em até 24 h).
 * Roda só depois de a denúncia ter sido aceita; falha no envio nunca afeta quem denunciou.
 */
@Injectable()
export class ReportAlertInterceptor implements NestInterceptor {
  private readonly target: ModerationAlertTarget;
  constructor(@Inject(MODERATION_ALERT) target: ModerationAlertTarget) {
    this.target = target;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{ method: string; originalUrl?: string; url: string; body?: unknown }>();
    const what = reportKind(req.method, req.originalUrl ?? req.url);
    if (what === undefined || this.target.alerter === undefined) return next.handle();
    const body = req.body;
    const reason = typeof body === 'object' && body !== null && typeof (body as { reason?: unknown }).reason === 'string' ? (body as { reason: string }).reason.slice(0, 40) : undefined;
    return next.handle().pipe(
      tap(() => {
        void this.target.alerter?.sendModerationAlert({ to: this.target.to, what, reason }).catch(() => undefined);
      }),
    );
  }
}
