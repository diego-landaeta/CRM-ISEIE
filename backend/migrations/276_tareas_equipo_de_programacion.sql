-- 276 · Equipos de programación en el tablero (CRM-ISEIE#419, Diego y Carlos, 09-10/11/2026)
--
-- La regla nueva del tablero: quien hace la tarea la pasa a «Hecha» él mismo,
-- sin pasar por «En revisión». La EXCEPCIÓN son las tareas de programación: el
-- programador la manda a revisar y la cierra Diego, que es su supervisor.
--
-- En la base no había nada que dijera qué tarea es «de programación»: ni un
-- tipo de equipo (task_teams.tipo es colaboradores/tutores), ni un área ni una
-- etiqueta fijas. Se marca en el EQUIPO de la tarea, que es el de quien la lleva:
--
--   · task_teams.de_programacion: sus tareas las cierra el supervisor (o un
--     superadmin), no quien la lleva. Se cambia en «Gestionar equipos».
--
-- De serie se marcan los equipos cuyo nombre dice «desarrollo» o «programación»
-- (el de hoy es «Desarrollo y SEO»). Solo al añadir la columna: si alguien la
-- desmarca después, volver a pasar la migración no la vuelve a marcar.
--
-- Se puede pasar dos veces.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'task_teams' AND column_name = 'de_programacion') THEN
    ALTER TABLE task_teams ADD COLUMN de_programacion BOOLEAN NOT NULL DEFAULT FALSE;
    UPDATE task_teams
       SET de_programacion = TRUE
     WHERE lower(name) ~ '(desarrollo|programaci[oó]n)';
  END IF;
END $$;

COMMENT ON COLUMN task_teams.de_programacion IS
  'Equipo de programación (CRM-ISEIE#419): sus tareas las cierra el supervisor (Diego) o un superadmin; quien la lleva solo la manda a revisar.';

COMMIT;
