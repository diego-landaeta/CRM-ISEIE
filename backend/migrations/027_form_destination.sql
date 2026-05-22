-- ============================================================
-- 027: Webhook destination + listen mode default
-- ============================================================

ALTER TABLE form_templates
  ADD COLUMN IF NOT EXISTS destination VARCHAR(30) NOT NULL DEFAULT 'lead';
  -- destination: 'lead' | 'matricula' (puede crecer)
