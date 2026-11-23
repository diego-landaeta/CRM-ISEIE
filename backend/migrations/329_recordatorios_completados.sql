-- Migración 329: cuándo y quién completó cada recordatorio (CRM-ISEIE#169, gemela de la 319 de MultiCRM, CRM#1041).
--
-- «Qué ha pasado hoy» (CRM#400; aquí, la v2.6.0, PR #380) recoge la actividad de lo que ya queda escrito, sin
-- tabla propia. Los recordatorios solo guardaban `completado` (sí/no): no se sabía
-- cuándo ni quién, así que no podían salir. Desde aquí se apunta al completarlos.
-- Los ya completados se quedan sin fecha: no se inventa una.

BEGIN;

ALTER TABLE lead_reminders ADD COLUMN IF NOT EXISTS completado_at  TIMESTAMPTZ;
ALTER TABLE lead_reminders ADD COLUMN IF NOT EXISTS completado_por INTEGER
    REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_lead_reminders_completado_at
    ON lead_reminders (completado_at DESC) WHERE completado_at IS NOT NULL;

COMMIT;
