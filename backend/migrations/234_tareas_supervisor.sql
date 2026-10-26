-- 234 · El supervisor de una tarea (Diego, 26/10/2026)
--
-- «Quienes puedan dar tareas a otros (Diego, Julián, Jesús, Eduardo, Ruth, Ángel
-- de CEDIA) también pueden ser supervisores de esas tareas entre todos; por
-- ejemplo, si Julián pone una tarea a Diana y la supervisa Ángel, se puede, y
-- eso debe llegar por correo».
--
-- Una persona del equipo que sigue la tarea: la ve, recibe el correo al ponerla
-- y cuando la tarea pasa a «En revisión», y la aprueba o la devuelve aunque no
-- tenga «Aprobar y cerrar». Lo pone quien tiene «Asignar» (tasks.assign).
--
-- El código funciona también sin esta migración (sin supervisor), para que un
-- despliegue antes de pasarla no tumbe el tablero. Se puede pasar dos veces.

BEGIN;

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS supervisor_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_supervisor ON tasks(supervisor_id) WHERE supervisor_id IS NOT NULL;

COMMENT ON COLUMN tasks.supervisor_id IS
  'Quien supervisa la tarea: la ve, recibe los avisos y la aprueba o devuelve (Diego, 26/10/2026).';

COMMIT;
