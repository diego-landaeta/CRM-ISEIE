-- Formaciones · alumnos activos (CRM-ISEIE#767, gemela de CRM#1113; allí es la 329)
--
-- Diego, 24/11/2026: en Productos › Formaciones, «que se puedan ver los alumnos
-- en activo y eso con el tema de los pagos y todo, para saber cuántos hay por
-- programa, y tener en cuenta los tiempos de publicación de cada proyecto como
-- en el Moodle».
--
-- Un alumno está ACTIVO mientras dura su acceso. El fin del acceso sale, en
-- este orden (formacion-alumnos.reglas.js, `finDeAcceso`):
--   1. la fecha de fin de la formación (`products.fecha_fin`, migración 325);
--   2. la duración publicada de la formación (`products.duracion`, la de la
--      web: «2 meses», «1 año», «6-7 meses»), contada desde el inicio del
--      alumno (`conversions.fecha_inicio`) o, sin él, desde la venta;
--   3. la regla del campus para su tipo (curso, diplomado o máster), que es lo
--      que añade esta migración;
--   4. sin regla del campus, la de serie: curso 3 meses, diplomado 6, máster 12.
--
-- El CRM no sabe hoy la fecha de fin de la matrícula en Moodle (ni la
-- matrícula automática ni el plugin la leen): cuando la sepa, irá delante.
--
--   projects.acceso_alumnos_meses   {"curso": 3, "diplomado": 6, "master": 12}
--                                   NULL = la de serie. Una clave que falta,
--                                   la de serie para ese tipo.
--
-- Solo una columna nueva, con IF NOT EXISTS: se puede pasar dos veces. Sin ella
-- el código usa la regla de serie (no falla), así que el código puede ir antes.
--

ALTER TABLE projects ADD COLUMN IF NOT EXISTS acceso_alumnos_meses JSONB;

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_acceso_alumnos_meses_check;
ALTER TABLE projects ADD CONSTRAINT projects_acceso_alumnos_meses_check
  CHECK (acceso_alumnos_meses IS NULL OR jsonb_typeof(acceso_alumnos_meses) = 'object');

COMMENT ON COLUMN projects.acceso_alumnos_meses IS
  'Meses de acceso de un alumno por tipo de formación (CRM#1113), si la formación no tiene fecha de fin ni duración: {"curso":3,"diplomado":6,"master":12}. NULL = la regla de serie.';
