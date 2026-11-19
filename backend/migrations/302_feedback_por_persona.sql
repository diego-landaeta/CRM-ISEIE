-- 302 · Feedback: una vez por PERSONA y reintentos (02/11/2026, CRM#593)
-- (Gemela de la 301 del CRM 360, PR CRM#866; en ISEIE la 301 es la de Certifex.)
--
-- · «Una vez por persona» (#169) era una vez por FICHA: la misma persona con
--   dos fichas (otro campus, un duplicado) recibía dos encuestas, y quien
--   compró con una recibía «¿por qué has desistido?» por la otra. Ahora se
--   mira el correo de todas sus fichas; estos índices hacen que buscar por
--   correo no recorra la tabla en cada vuelta del día 7.
-- · `intentos`: un correo que falló o se quedó a medias (un despliegue durante
--   una tanda) se reintenta, como mucho tres veces. Antes no se reintentaba
--   nunca: la fila ya existía y el día 7 la saltaba.
-- Se puede pasar dos veces.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_leads_email_normalizado
  ON leads (lower(trim(email))) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_feedback_envios_email_normalizado
  ON feedback_envios (lower(trim(email))) WHERE email IS NOT NULL;

ALTER TABLE feedback_envios ADD COLUMN IF NOT EXISTS intentos INTEGER NOT NULL DEFAULT 0;
COMMENT ON COLUMN feedback_envios.intentos IS
  'Veces que se ha intentado mandar el correo (302). Un fallido o un pendiente atascado se reintenta hasta 3.';

-- Los que ya salieron o fallaron cuentan como un intento hecho.
UPDATE feedback_envios SET intentos = 1
 WHERE intentos = 0 AND estado IN ('enviado', 'fallido', 'bloqueado');

COMMIT;
