-- 241 · La fecha de terminada de cada tarea, cuadrada con su estado (Diego, 27/10/2026)
--
-- «Esto tiene que tener fecha de cuándo se creó y cuándo se terminó, y
-- clasificarla en vistas por día, semana y mes.»
--
-- La columna ya existe desde la 207 (`tasks.completed_at`; en MultiCRM, la 193) y el servidor la
-- pone al pasar a «Hecha» (arrastrando o aprobando) y la borra al volver atrás.
-- Esta migración solo deja los datos de antes en orden, para que el periodo
-- del tablero no se equivoque:
--
--   · Hecha y sin fecha: el último paso a «Hecha» del historial (task_events);
--     si no lo hay, su updated_at.
--   · No hecha y con fecha: se borra (se reabrió y la fecha quedó colgada).
--
-- No cambia updated_at. Se puede pasar dos veces.

BEGIN;

UPDATE tasks t
   SET completed_at = COALESCE(
         (SELECT MAX(te.created_at) FROM task_events te
           WHERE te.task_id = t.id AND te.event_type = 'status_changed'
             AND te.details->>'new_status' = 'hecha'),
         t.updated_at)
 WHERE t.status = 'hecha' AND t.completed_at IS NULL;

UPDATE tasks SET completed_at = NULL
 WHERE status <> 'hecha' AND completed_at IS NOT NULL;

COMMIT;
