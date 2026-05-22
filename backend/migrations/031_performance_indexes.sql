-- Migración 031: índices FK faltantes + columna notificado_at en lead_reminders

CREATE INDEX IF NOT EXISTS idx_conversions_lead_id ON conversions(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_reminders_lead_id ON lead_reminders(lead_id);

ALTER TABLE lead_reminders ADD COLUMN IF NOT EXISTS notificado_at TIMESTAMPTZ;
