-- Formaciones: «se desbloquea a los X días» por módulo (gemela de CRM#1124)
--
-- Diego, 25/11/2026: en los Moodle hay un plugin que abre cada sección a los X días de
-- empezar el curso (`availability_relativedate`, «Fecha relativa»). En la ficha de la
-- formación, cada módulo tiene «Se desbloquea a los … días», y «Crear en Moodle» (fase 2)
-- se lo manda al plugin del CRM 1.12.0, que pone la restricción en su sección.
--
-- NULL = desde el principio (y en Moodle no se toca la restricción de esa sección).
-- Va con la fase 2: la pantalla solo enseña el campo con FORMACIONES_MOODLE_EN_PRODUCCION
-- encendido; hasta entonces la columna se queda vacía.
-- Con IF NOT EXISTS: se puede pasar dos veces.

ALTER TABLE product_modules ADD COLUMN IF NOT EXISTS dias_desbloqueo INTEGER;

ALTER TABLE product_modules DROP CONSTRAINT IF EXISTS product_modules_dias_desbloqueo_check;
ALTER TABLE product_modules ADD CONSTRAINT product_modules_dias_desbloqueo_check
  CHECK (dias_desbloqueo IS NULL OR dias_desbloqueo BETWEEN 1 AND 3650);

COMMENT ON COLUMN product_modules.dias_desbloqueo IS
  'Se desbloquea a los X días del inicio del curso en Moodle (CRM#1124). NULL = desde el principio.';
