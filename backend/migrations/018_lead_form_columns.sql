-- ============================================================
-- 018: Configuracion de campos base y columnas del listado de leads
-- ============================================================

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS lead_base_fields_config JSONB NOT NULL DEFAULT '{
    "telefono": {"required": false, "visible": true},
    "producto_interes_id": {"required": false, "visible": true},
    "notas": {"required": false, "visible": true}
  }'::jsonb,
  ADD COLUMN IF NOT EXISTS lead_columns JSONB NOT NULL DEFAULT '[
    {"key": "nombre", "label": "Nombre", "visible": true},
    {"key": "email", "label": "Email", "visible": true},
    {"key": "telefono", "label": "Telefono", "visible": true},
    {"key": "canal_detectado", "label": "Origen", "visible": true},
    {"key": "status", "label": "Estado", "visible": true},
    {"key": "responsable_nombre", "label": "Gestor", "visible": true},
    {"key": "fecha_solicitud", "label": "Fecha", "visible": true}
  ]'::jsonb;

-- Asegurar defaults en filas existentes (si la columna ya existe sin default poblado)
UPDATE projects
   SET lead_base_fields_config = '{
       "telefono": {"required": false, "visible": true},
       "producto_interes_id": {"required": false, "visible": true},
       "notas": {"required": false, "visible": true}
     }'::jsonb
 WHERE lead_base_fields_config IS NULL OR lead_base_fields_config::text = '{}';

UPDATE projects
   SET lead_columns = '[
       {"key": "nombre", "label": "Nombre", "visible": true},
       {"key": "email", "label": "Email", "visible": true},
       {"key": "telefono", "label": "Telefono", "visible": true},
       {"key": "canal_detectado", "label": "Origen", "visible": true},
       {"key": "status", "label": "Estado", "visible": true},
       {"key": "responsable_nombre", "label": "Gestor", "visible": true},
       {"key": "fecha_solicitud", "label": "Fecha", "visible": true}
     ]'::jsonb
 WHERE lead_columns IS NULL OR jsonb_array_length(lead_columns) = 0;
