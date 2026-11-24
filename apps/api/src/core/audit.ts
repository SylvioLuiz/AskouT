import type { CoreDeps } from './ports.ts';
import type { AuditAction, AuditActorKind, AuditChange, AuditTargetType } from './types.ts';

export interface AuditEntry {
  /** Quem fez. Nulo quando foi o sistema. */
  actorId: string | null;
  actorKind: AuditActorKind;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string;
  targetLabel?: string | null;
  changes?: AuditChange[] | null;
  note?: string | null;
}

/**
 * Registra na auditoria da gestão uma ação sensível que não vem do painel (a pessoa no app ou o sistema).
 * Melhor esforço: falhar ao registrar nunca desfaz nem bloqueia o que a pessoa fez.
 */
export async function recordAudit(deps: Pick<CoreDeps, 'admin' | 'ids' | 'clock'>, entry: AuditEntry): Promise<void> {
  try {
    await deps.admin.addAudit({
      id: deps.ids.next(),
      adminId: entry.actorId,
      actorKind: entry.actorKind,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      targetLabel: entry.targetLabel ?? null,
      changes: entry.changes && entry.changes.length > 0 ? entry.changes : null,
      note: entry.note ? entry.note.slice(0, 400) : null,
      createdAt: deps.clock.now(),
    });
  } catch {
    // melhor esforço
  }
}

/** Valor em reais para a auditoria ("R$ 49,90"). */
export function brl(cents: number): string {
  return `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;
}
