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
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_audit_shape') THEN
    ALTER TABLE "AdminAudit" ADD CONSTRAINT admin_audit_shape CHECK (
      "action" IN ('USER_SUSPENDED', 'USER_REACTIVATED', 'CLAIM_APPROVED', 'CLAIM_REJECTED', 'VENUE_OWNER_REMOVED', 'POST_REMOVED', 'PLACE_EVENT_REMOVED', 'REPORT_DISMISSED', 'REPORT_ACTIONED')
      AND ("note" IS NULL OR char_length("note") <= 300)
    );
  END IF;
END
$$;
