-- ============================================================
-- Migración 043: paneles externos por proyecto (CRM-155)
-- Permite a superadmin/admin configurar enlaces externos (Stripe,
-- WhatsApp Web, etc.) que aparecen como items en el sidebar y se
-- abren embebidos via iframe o en pestaña nueva.
-- ============================================================

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS external_panels JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Forma esperada del JSON:
-- [
--   {
--     "id": "uuid",
--     "label": "Stripe",
--     "url": "https://dashboard.stripe.com/...",
--     "icon": "CreditCard",     -- nombre de un icono Phosphor (opcional)
--     "open_in": "iframe"       -- "iframe" | "tab" (default iframe)
--   }
-- ]
