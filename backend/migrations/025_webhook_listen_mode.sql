-- ============================================================
-- 025: Modo escucha tipo Make/Zapier para webhook tokens
-- ============================================================

ALTER TABLE project_webhook_tokens
  ADD COLUMN IF NOT EXISTS awaiting_sample BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sample_payload JSONB,
  ADD COLUMN IF NOT EXISTS sample_received_at TIMESTAMPTZ;

-- Lo mismo para forms (kind=webhook)
ALTER TABLE form_templates
  ADD COLUMN IF NOT EXISTS awaiting_sample BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sample_payload JSONB,
  ADD COLUMN IF NOT EXISTS sample_received_at TIMESTAMPTZ;
