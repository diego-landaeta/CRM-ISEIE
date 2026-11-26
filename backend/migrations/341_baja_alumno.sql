-- ============================================================
-- 341: baja o desistimiento del alumno en la venta (sobre CRM#1113 / CRM-ISEIE#767, alumnos activos)
-- ============================================================
-- Diego, 25/11/2026: en Productos › Formaciones › Alumnos un alumno solo deja
-- de contar como activo si su factura se anula o hay devolución. Se quiere
-- poder apuntar la BAJA en la venta: fecha, motivo y nota. Se puede deshacer y
-- queda en su historial con quién y cuándo.
--
-- La baja NO anula facturas ni toca cobros, cuotas ni el cobro automático, y no
-- da de baja en Moodle (lo hacen las tutoras o Make). Tampoco es CRM#531
-- (impagos y suspensiones de Make en la ficha, en espera de Carlos).
--
-- No reutiliza `feedback_envios` (#169/#170): aquello es el «¿por qué has
-- desistido?» de un PROSPECTO que no compró; esto es un ALUMNO que ya compró.
--
--   conversions.baja_fecha    desde cuándo deja de ser activo. NULL = sin baja.
--   conversions.baja_motivo   desistimiento (en plazo) · voluntaria · impago · otro.
--   conversions.baja_nota     lo que quiera dejar escrito quien la apunta.
--   conversions.baja_por/at   quién la apuntó (o la cambió) y cuándo.
--   conversion_bajas_historial  cada baja, cambio y «deshacer», con quién y cuándo.
--
-- El motivo es VARCHAR con CHECK, no un ENUM: una lista corta que puede crecer
-- sin `ALTER TYPE` (que no va dentro de una transacción).
--
-- Se puede pasar dos veces (IF NOT EXISTS). Sin ella, Alumnos cuenta como antes
-- (formacion-alumnos.service.js lo tolera); la ficha de la venta avisa.
-- Mismo contenido en los dos CRMs (aquí 341; en el 360, 330).

BEGIN;

ALTER TABLE conversions
  ADD COLUMN IF NOT EXISTS baja_fecha  DATE,
  ADD COLUMN IF NOT EXISTS baja_motivo VARCHAR(20),
  ADD COLUMN IF NOT EXISTS baja_nota   TEXT,
  ADD COLUMN IF NOT EXISTS baja_por    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS baja_at     TIMESTAMPTZ;

ALTER TABLE conversions DROP CONSTRAINT IF EXISTS conversions_baja_motivo_check;
ALTER TABLE conversions ADD CONSTRAINT conversions_baja_motivo_check
  CHECK (baja_motivo IS NULL OR baja_motivo IN ('desistimiento', 'voluntaria', 'impago', 'otro'));

-- Fecha y motivo van juntos: o hay baja entera o no hay.
ALTER TABLE conversions DROP CONSTRAINT IF EXISTS conversions_baja_completa_check;
ALTER TABLE conversions ADD CONSTRAINT conversions_baja_completa_check
  CHECK ((baja_fecha IS NULL) = (baja_motivo IS NULL));

CREATE INDEX IF NOT EXISTS idx_conversions_baja_fecha
  ON conversions (baja_fecha) WHERE baja_fecha IS NOT NULL;

COMMENT ON COLUMN conversions.baja_fecha IS
  'Baja del alumno (CRM-ISEIE#767, gemela de CRM#1113): desde esta fecha deja de contar como activo en Formaciones › Alumnos. NULL = sin baja. No toca facturas, cobros ni Moodle.';
COMMENT ON COLUMN conversions.baja_motivo IS
  'desistimiento (en plazo) | voluntaria | impago | otro. Va junto a baja_fecha.';

CREATE TABLE IF NOT EXISTS conversion_bajas_historial (
  id             SERIAL       PRIMARY KEY,
  conversion_id  INTEGER      NOT NULL REFERENCES conversions(id) ON DELETE CASCADE,
  accion         VARCHAR(12)  NOT NULL,
  fecha_baja     DATE,
  motivo         VARCHAR(20),
  nota           TEXT,
  user_id        INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT conversion_bajas_historial_accion_check CHECK (accion IN ('baja', 'cambio', 'deshecha')),
  CONSTRAINT conversion_bajas_historial_motivo_check
    CHECK (motivo IS NULL OR motivo IN ('desistimiento', 'voluntaria', 'impago', 'otro'))
);

CREATE INDEX IF NOT EXISTS idx_conversion_bajas_historial_venta
  ON conversion_bajas_historial (conversion_id, created_at DESC);

COMMENT ON TABLE conversion_bajas_historial IS
  'Historial de la baja del alumno en cada venta (CRM-ISEIE#767, gemela de CRM#1113): baja, cambio o deshecha, con quién y cuándo.';

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON conversion_bajas_historial TO %I', r);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE conversion_bajas_historial_id_seq TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;
