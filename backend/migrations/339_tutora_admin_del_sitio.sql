-- TUTORA CON LA CUENTA DE ADMINISTRACIÓN DEL SITIO, COMO EXCEPCIÓN (24/11/2026).
--
-- Hasta hoy el CRM nunca enlazaba a una tutora con la cuenta de Moodle que es
-- administradora del sitio, aunque diera clase con ella (revisión de la #689:
-- «nunca el administrador del sitio»). Diego, 24/11: una tutora de un campus solo
-- tiene esa cuenta, da clase con ella y «es necesario que entre».
--
-- Ahora se puede, SOLO como excepción explícita: la confirma en la ficha de la
-- tutora quien tiene `tutores.gestionar`, viendo el aviso «Es la cuenta de
-- administración del sitio; se enlaza igual porque ella da clase con ella».
-- Sin esa confirmación, el CRM sigue diciendo que no (409 ADMIN_DEL_SITIO).
--
-- Queda anotado aquí: cuándo y quién. La comprobación de cada hora no lo toca (solo
-- lo quitan «Vincular de nuevo» o vincular otra cuenta). Con la excepción, «Mi campus»
-- lee sus cursos, tareas, entregas y dudas, pero responder y corregir se hacen desde
-- Moodle: el plugin del CRM no envía ni califica como el administrador del sitio
-- (desde la 1.10.1).

ALTER TABLE tutor_campus
  ADD COLUMN IF NOT EXISTS admin_sitio_excepcion_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS admin_sitio_excepcion_por INTEGER REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON COLUMN tutor_campus.admin_sitio_excepcion_at IS
  'Cuándo se confirmó enlazar a la tutora con la cuenta de administración del sitio de ese campus (excepción). NULL = no es esa cuenta, o no se ha confirmado.';
COMMENT ON COLUMN tutor_campus.admin_sitio_excepcion_por IS
  'Quién confirmó la excepción (necesita tutores.gestionar).';
