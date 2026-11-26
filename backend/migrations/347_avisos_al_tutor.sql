-- «Avisar al tutor» desde Comisiones: quién lo mandó y cuándo, cada vez.
-- CRM#165 y su gemela CRM-ISEIE#188 (Diego, 25/11/2026). La misma migración en
-- los dos CRM; el número cambia porque cada repo numera por su lado.
--
--   «Queda anotado quién y cuándo lo mandó, y avisa si ya se le mandó ese mes.»
--
-- Reaplicable: todo es IF NOT EXISTS y el relleno solo copia lo que falta.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1 · EL ÚLTIMO AVISO EN CADA COMISIÓN
--
-- En MultiCRM ya están (migración 160); en CRM-ISEIE se crean aquí. Avisar no es
-- cobrar: el estado del dinero no se toca y una comisión avisada sigue «por
-- pagar». Esto dice CUÁNDO se le avisó por última vez.
ALTER TABLE tutor_commissions
  ADD COLUMN IF NOT EXISTS avisado_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS avisado_por INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tc_avisado_por') THEN
    ALTER TABLE tutor_commissions
      ADD CONSTRAINT fk_tc_avisado_por FOREIGN KEY (avisado_por)
      REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2 · CADA ENVÍO, UNA FILA
--
-- Las columnas de arriba solo guardan el último. Para saber que ya se le mandó
-- el de ese mes, quién y cuándo, y si se le ha repetido, cada envío queda aquí.
-- Solo los que salieron: los que Brevo o el freno no dejaron pasar están en el
-- registro de correos, no aquí.
CREATE TABLE IF NOT EXISTS tutor_avisos_comisiones (
  id            SERIAL PRIMARY KEY,
  tutor_id      INTEGER       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  periodo       CHAR(7)       NOT NULL,                 -- 'AAAA-MM', el mes que se le reclama
  enviado_por   INTEGER       REFERENCES users(id) ON DELETE SET NULL,
  enviado_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  email         VARCHAR(255),                           -- a donde salió
  pendiente     NUMERIC(12,2),                          -- lo que se le debía (la comisión)
  total         NUMERIC(12,2),                          -- lo que se le pidió facturar (+ IVA − retención)
  asunto        TEXT,
  project_ids   INTEGER[],                              -- los campus que iban en el correo
  comisiones    INTEGER[],                              -- las líneas de tutor_commissions
  brevo_msg_id  TEXT
);

COMMENT ON TABLE tutor_avisos_comisiones IS
  'Cada «Avisar al tutor» enviado desde Comisiones: quién, cuándo, a dónde y por cuánto (CRM#165 / CRM-ISEIE#188).';

CREATE INDEX IF NOT EXISTS idx_tutor_avisos_mes
  ON tutor_avisos_comisiones (tutor_id, periodo, enviado_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3 · LOS AVISOS DE ANTES
--
-- En MultiCRM ya se mandaban avisos y solo quedaba `avisado_at` en las líneas.
-- Se pasan aquí, uno por tutor y mes, para que el «ya se le mandó» los vea. En
-- CRM-ISEIE no hay ninguno y no copia nada.
INSERT INTO tutor_avisos_comisiones (tutor_id, periodo, enviado_por, enviado_at, email)
SELECT tc.tutor_id, tc.periodo,
       (ARRAY_AGG(tc.avisado_por ORDER BY tc.avisado_at DESC))[1],
       MAX(tc.avisado_at),
       u.email
  FROM tutor_commissions tc
  JOIN users u ON u.id = tc.tutor_id
 WHERE tc.avisado_at IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM tutor_avisos_comisiones a
                    WHERE a.tutor_id = tc.tutor_id AND a.periodo = tc.periodo)
 GROUP BY tc.tutor_id, tc.periodo, u.email;

COMMIT;
