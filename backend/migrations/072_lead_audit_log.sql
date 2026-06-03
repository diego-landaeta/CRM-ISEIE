-- Audit log de cambios en la ficha de un lead.
-- Una fila por cada campo modificado (nombre/email/telefono/canal/producto/notas/responsable/...).
-- Cambios de status siguen en lead_status_history (legacy). Reasignación se duplica aquí + interaction.

CREATE TABLE IF NOT EXISTS lead_audit_log (
  id                    SERIAL PRIMARY KEY,
  lead_id               INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  field_name            VARCHAR(80) NOT NULL,         -- 'email', 'telefono', 'nombre', 'canal', 'producto_interes_id', 'notas', 'responsable_id', ...
  old_value             TEXT,                          -- representación textual del valor previo (NULL si era null)
  new_value             TEXT,                          -- ídem nuevo
  changed_by_user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  changed_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_audit_lead_changed ON lead_audit_log(lead_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_audit_field ON lead_audit_log(field_name);
