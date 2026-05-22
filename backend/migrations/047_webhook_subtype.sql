-- ============================================================
-- Migración 047: distinguir webhook JSON vs mailhook (email entrante)
-- ============================================================

-- Modo de recepción cuando kind='webhook':
--   'json'  → webhook clásico (POST con JSON, llamado por Elementor/Make/Zapier/etc.)
--   'email' → mailhook (recibe email parseado por Cloudflare/Brevo/Mailgun)
--   'both'  → ambos endpoints activos
ALTER TABLE form_templates
  ADD COLUMN IF NOT EXISTS webhook_mode VARCHAR(10) NOT NULL DEFAULT 'both';

COMMENT ON COLUMN form_templates.webhook_mode IS
  'Solo aplica cuando kind=webhook: json | email | both';
