-- La hora a la que sincroniza cada proyecto su catalogo.
--
-- Diego, 18/09: «que cada 12 horas se sincronicen, no todas a las 12 horas, si
-- no iseie por ejemplo a la 1, iseih a las 2, que sean diferentes».
--
-- Antes el planificador contaba minutos desde la ultima vez. Funciona, pero se
-- desplaza: cada vuelta suma lo que tardo la anterior mas el margen del reloj,
-- y en una semana ya no sincroniza a la hora que era. Ademas, arrancando todos
-- del mismo punto acababan pisandose.
--
-- Con la hora anclada, cada proyecto entra a la suya y a esa mas el ciclo. Con
-- 720 minutos son dos pasadas al dia. La hora es la de Espana (Europe/Madrid),
-- no la del servidor, que va en UTC.
--
-- NULL = comportamiento de siempre, contando desde la ultima sincronizacion.
ALTER TABLE wc_credentials
  ADD COLUMN IF NOT EXISTS sync_anchor_hour SMALLINT;

COMMENT ON COLUMN wc_credentials.sync_anchor_hour IS
  'Hora de Espana (0-23) a la que arranca la sincronizacion. NULL = por intervalo desde la ultima.';
