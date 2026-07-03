-- Migración 101: Regímenes fiscales + coletillas parametrizadas (editables desde el panel).
-- Textos borrador (a validar con asesoría). Se pueden modificar desde Config de facturación.
CREATE TABLE IF NOT EXISTS fiscal_regimenes (
  id          SERIAL PRIMARY KEY,
  project_id  INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  clave       VARCHAR(40),
  nombre      VARCHAR(120) NOT NULL,
  aplica_iva  BOOLEAN NOT NULL DEFAULT false,
  iva_pct     NUMERIC(5,2) NOT NULL DEFAULT 0,
  coletilla   TEXT,
  orden       INTEGER NOT NULL DEFAULT 0,
  activo      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fiscal_regimen_clave_global ON fiscal_regimenes (clave) WHERE project_id IS NULL;

INSERT INTO fiscal_regimenes (project_id, clave, nombre, aplica_iva, iva_pct, coletilla, orden) VALUES
 (NULL,'es_21',     'España — 21% IVA',                          true,  21, NULL, 1),
 (NULL,'es_exento', 'España — Formación exenta',                 false,  0, 'Operación exenta de IVA conforme al art. 20.Uno.9º de la Ley 37/1992.', 2),
 (NULL,'canarias',  'Canarias (IGIC)',                           false,  0, 'Operación exenta — asimilada a exportación (art. 21 LIVA).', 3),
 (NULL,'ue_b2b',    'UE B2B (VIES válido)',                      false,  0, 'Inversión del sujeto pasivo (art. 84.Uno.2º LIVA / art. 196 Directiva 2006/112/CE).', 4),
 (NULL,'ue_b2c',    'UE B2C (servicios digitales — a confirmar)', true, 21, NULL, 5),
 (NULL,'fuera_ue',  'Fuera de la UE',                            false,  0, 'Operación no sujeta / exenta — exportación de servicios.', 6)
ON CONFLICT (clave) WHERE project_id IS NULL DO NOTHING;
