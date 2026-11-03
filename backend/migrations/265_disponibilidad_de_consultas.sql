-- CRM-ISEIE 265 = MultiCRM 223 (paridad 2.6.0, 03/11/2026). Mismo SQL;
-- solo cambia el número, al primer hueco libre de ISEIE.
--
-- 223 · «No disponible» de Consultas, en columnas propias (QA de Diego, 22/10,
-- punto 6).
--
-- «"No disponible" usa `users.is_available`, que es la misma columna del
-- reparto de prospectos. Usa una propia.» Una gestora que además es tutora y
-- se ponía de vacaciones en Consultas dejaba de recibir prospectos, y al revés.
--
--   · consultas_disponible: false = no recibe consultas nuevas (vacaciones o
--     baja, decisión 6 de la fase 0). No toca el reparto.
--   · consultas_no_disponible_motivo / _desde: lo mismo que unavailable_reason
--     y unavailable_since, pero de Consultas.
--
-- Lo que ya hubiera: solo los tutores PUROS (rol principal tutor) marcados no
-- disponibles se pasan a Consultas, porque su `is_available` solo lo cambiaba
-- Consultas (no reciben prospectos). El de quien tiene otro rol se queda en el
-- reparto, que es de donde es.
--
-- 223: Diego pidió «a partir de la 214», y las PR abiertas de Ángel y Hugo ya
-- usan de la 214 a la 222. Se puede pasar dos veces.

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS consultas_disponible BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS consultas_no_disponible_motivo TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS consultas_no_disponible_desde TIMESTAMPTZ;

COMMENT ON COLUMN users.consultas_disponible IS 'Consultas de alumnos: false = no recibe consultas nuevas (vacaciones o baja). Independiente de is_available (reparto de prospectos).';
COMMENT ON COLUMN users.consultas_no_disponible_motivo IS 'Consultas de alumnos: por qué no está disponible.';
COMMENT ON COLUMN users.consultas_no_disponible_desde IS 'Consultas de alumnos: desde cuándo no está disponible.';

UPDATE users
   SET consultas_disponible = FALSE,
       consultas_no_disponible_motivo = unavailable_reason,
       consultas_no_disponible_desde = unavailable_since
 WHERE role = 'tutor'
   AND is_available = FALSE
   AND consultas_disponible = TRUE
   AND consultas_no_disponible_desde IS NULL;

COMMIT;
