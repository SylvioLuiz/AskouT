-- Auditoria mais completa: ações de quem usa o app e do sistema (sem admin), nome do alvo e o que mudou campo a campo.
ALTER TABLE "AdminAudit" ALTER COLUMN "adminId" DROP NOT NULL;
ALTER TABLE "AdminAudit" ADD COLUMN "actorKind" TEXT NOT NULL DEFAULT 'ADMIN';
ALTER TABLE "AdminAudit" ADD COLUMN "targetLabel" TEXT;
ALTER TABLE "AdminAudit" ADD COLUMN "changes" JSONB;

CREATE INDEX "AdminAudit_adminId_createdAt_idx" ON "AdminAudit"("adminId", "createdAt");
CREATE INDEX "AdminAudit_targetType_targetId_idx" ON "AdminAudit"("targetType", "targetId");
CREATE INDEX "AdminAudit_action_createdAt_idx" ON "AdminAudit"("action", "createdAt");
