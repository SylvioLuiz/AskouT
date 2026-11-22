-- Aplicar depois da migration admin. Pode ser rodado de novo sem erro.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_report_resolution_shape') THEN
    ALTER TABLE "PostReport" ADD CONSTRAINT post_report_resolution_shape CHECK (
      ("resolvedAt" IS NULL AND "resolvedBy" IS NULL AND "resolution" IS NULL)
      OR ("resolvedAt" IS NOT NULL AND "resolution" IN ('DISMISSED', 'ACTIONED'))
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversation_report_resolution_shape') THEN
    ALTER TABLE "ConversationReport" ADD CONSTRAINT conversation_report_resolution_shape CHECK (
      ("resolvedAt" IS NULL AND "resolvedBy" IS NULL AND "resolution" IS NULL)
      OR ("resolvedAt" IS NOT NULL AND "resolution" IN ('DISMISSED', 'ACTIONED'))
    );
  END IF;
  -- Auditoria: só o tamanho da nota. A lista de ações cresce com o código (corrigir data, editar perfil, gostos...) e uma
  -- lista fixa aqui fazia essas ações darem erro. Versão antiga (com a lista) é trocada por esta.
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_audit_shape' AND conrelid = '"AdminAudit"'::regclass AND pg_get_constraintdef(oid) LIKE '%action%') THEN
    ALTER TABLE "AdminAudit" DROP CONSTRAINT admin_audit_shape;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_audit_shape') THEN
    ALTER TABLE "AdminAudit" ADD CONSTRAINT admin_audit_shape CHECK ("note" IS NULL OR char_length("note") <= 400);
  END IF;
END
$$;
